import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, query, where,
  orderBy, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
const has = id => !!$(id);
let currentUser = null, currentProfile = null, authMode = "login", staffBookingsUnsub = null;
const statuses = ["Pending", "Assigned", "Working", "Completed", "Closed"];
const currency = n => "₹" + Number(n || 0).toLocaleString("en-IN");
const safe = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function message(id, text, type="") { if (!has(id)) return; $(id).textContent = text; $(id).className = "form-message " + type; }
function toast(text) { if (!has("toast")) return; $("toast").textContent=text; $("toast").classList.remove("hidden"); setTimeout(()=> $("toast")?.classList.add("hidden"), 3200); }
function setAuthMode(mode) {
  authMode=mode;
  if (has("loginTab")) $("loginTab").classList.toggle("active",mode==="login");
  if (has("registerTab")) $("registerTab").classList.toggle("active",mode==="register");
  if (has("authNameWrap")) $("authNameWrap").classList.toggle("hidden",mode!=="register");
  if (has("authTitle")) $("authTitle").textContent=mode==="login"?"Welcome back!":"Create your account";
  if (has("authSubtitle")) $("authSubtitle").textContent=mode==="login"?"Log in to book service and track requests.":"Register to book and track electrical repair services.";
  if (has("authSubmit")) $("authSubmit").textContent=mode==="login"?"Login":"Create account";
  message("authMessage","");
}
function openAuth() { if(has("authModal")) $("authModal").classList.remove("hidden"); }
function closeAuth() { if(has("authModal")) $("authModal").classList.add("hidden"); }
function niceError(err) {
  const map={"auth/email-already-in-use":"This email is already registered.","auth/invalid-credential":"Email or password is incorrect.","auth/weak-password":"Use a password with at least 6 characters.","auth/invalid-email":"Enter a valid email address.","auth/too-many-requests":"Too many attempts. Try again later.","permission-denied":"Permission denied. Check Firestore rules and your account role."};
  return map[err?.code] || err?.message || "Something went wrong. Please try again.";
}
function dateText(v) { if(!v) return "Not set"; try { if(v.toDate) return v.toDate().toLocaleString(); return new Date(v).toLocaleString(); } catch { return "Not set"; } }

if (has("year")) $("year").textContent = new Date().getFullYear();
if (has("menuBtn")) $("menuBtn").addEventListener("click",()=> $("mainNav")?.classList.toggle("open"));
if (has("openLogin")) $("openLogin").addEventListener("click",()=>{setAuthMode("login");openAuth();});
if (has("closeLogin")) $("closeLogin").addEventListener("click",closeAuth);
if (has("authModal")) $("authModal").addEventListener("click",e=>{if(e.target===$("authModal"))closeAuth();});
if (has("loginTab")) $("loginTab").addEventListener("click",()=>setAuthMode("login"));
if (has("registerTab")) $("registerTab").addEventListener("click",()=>setAuthMode("register"));
if (has("logoutBtn")) $("logoutBtn").addEventListener("click",()=>signOut(auth));
if (has("staffLogout")) $("staffLogout").addEventListener("click",()=>signOut(auth));
document.querySelectorAll("[data-service]").forEach(btn=>btn.addEventListener("click",()=>{if(has("service"))$("service").value=btn.dataset.service;document.querySelectorAll(".service-card").forEach(b=>b.classList.toggle("selected",b===btn));$("book")?.scrollIntoView({behavior:"smooth"});}));

if (has("authForm")) $("authForm").addEventListener("submit",async e=>{
  e.preventDefault(); message("authMessage","Working…");
  const email=$("authEmail").value.trim(), password=$("authPassword").value;
  try {
    if(authMode==="register") {
      const name=$("authName").value.trim();
      if(!name) throw new Error("Enter your full name.");
      const cred=await createUserWithEmailAndPassword(auth,email,password);
      await updateProfile(cred.user,{displayName:name});
      await setDoc(doc(db,"users",cred.user.uid),{uid:cred.user.uid,name,email,role:"customer",createdAt:serverTimestamp()});
      toast("Account created successfully."); closeAuth();
    } else {
      await signInWithEmailAndPassword(auth,email,password); toast("Logged in successfully."); closeAuth();
    }
  } catch(err) { message("authMessage",niceError(err),"error"); }
});

onAuthStateChanged(auth,async user=>{
  currentUser=user; currentProfile=null;
  if(user) {
    try { const snap=await getDoc(doc(db,"users",user.uid)); currentProfile=snap.exists()?snap.data():null; } catch(e){console.warn(e);}
  }
  if(has("openLogin")) {
    $("openLogin").classList.toggle("hidden",!!user);
    $("logoutBtn").classList.toggle("hidden",!user);
    if(user && has("customerName")) $("customerName").value=$("customerName").value || user.displayName || "";
    renderCustomerBookings();
  }
  if(has("staffLoginPanel")) await refreshStaffAccess();
});

if (has("bookingForm")) {
  const date=$("preferredDate"); if(date) date.min=new Date().toISOString().slice(0,10);
  $("bookingForm").addEventListener("submit",async e=>{
    e.preventDefault();
    if(!currentUser){setAuthMode("login");openAuth();message("authMessage","Please log in or create an account to book.");return;}
    if(!currentProfile || currentProfile.role!=="customer"){message("bookingMessage","This account is not set up as a customer account. Please contact support.","error");return;}
    message("bookingMessage","Submitting booking…");
    try {
      const data={customerUid:currentUser.uid,customerName:$("customerName").value.trim(),phone:$("phone").value.trim(),address:$("address").value.trim(),service:$("service").value,preferredDate:$("preferredDate").value,preferredTime:$("preferredTime").value,details:$("details").value.trim(),status:"Pending",proposedPrice:null,priceApproved:false,assignedTechnicianUid:null,assignedTechnicianName:null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
      await addDoc(collection(db,"bookings"),data);
      $("bookingForm").reset(); message("bookingMessage","Booking submitted. You can track it below.","success"); toast("Booking submitted."); await renderCustomerBookings();
    } catch(err) { message("bookingMessage",niceError(err),"error"); }
  });
}
if(has("refreshBookings")) $("refreshBookings").addEventListener("click",renderCustomerBookings);

async function renderCustomerBookings(){
  if(!has("customerBookings"))return;
  if(!currentUser){$("customerBookings").innerHTML='<div class="empty-state">Log in to view your bookings.</div>';return;}
  $("customerBookings").innerHTML='<div class="empty-state">Loading your bookings…</div>';
  try {
    const q=query(collection(db,"bookings"),where("customerUid","==",currentUser.uid));
    const snap=await getDocs(q); const items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if(!items.length){$("customerBookings").innerHTML='<div class="empty-state">No bookings yet. Choose a service above to get started.</div>';return;}
    $("customerBookings").innerHTML=items.map(b=>{
      const statusClass=(b.status||"Pending").toLowerCase();
      const price=b.proposedPrice!==null&&b.proposedPrice!==undefined?`<div class="price-box"><b>Proposed repair price: ${currency(b.proposedPrice)}</b>${b.priceApproved?'<p class="form-message success">Price approved</p>':b.status!=="Closed"?`<div class="price-actions"><button class="small-btn approve" data-action="approve" data-id="${safe(b.id)}">Approve price</button><button class="small-btn danger" data-action="decline" data-id="${safe(b.id)}">Ask to revise</button></div>`:""}</div>`:"";
      return `<article class="booking-item"><div><h3>${safe(b.service)}</h3><p>Booking ID: ${safe(b.id.slice(0,8).toUpperCase())} · ${safe(b.preferredDate||"Date not set")} · ${safe(b.preferredTime||"")}</p><p>${safe(b.address)}</p><p>${safe(b.details||"No extra details")}</p><div class="booking-meta"><span class="pill ${statusClass}">${safe(b.status||"Pending")}</span>${b.assignedTechnicianName?`<span class="pill">Technician: ${safe(b.assignedTechnicianName)}</span>`:""}</div>${price}</div></article>`;
    }).join("");
    $("customerBookings").querySelectorAll("[data-action]").forEach(btn=>btn.addEventListener("click",()=>customerPriceAction(btn.dataset.id,btn.dataset.action)));
  } catch(err){$("customerBookings").innerHTML=`<div class="empty-state">${safe(niceError(err))}</div>`;}
}
async function customerPriceAction(id,action){
  if(!currentUser)return;
  try {
    const ref=doc(db,"bookings",id), snap=await getDoc(ref);
    if(!snap.exists()||snap.data().customerUid!==currentUser.uid)throw new Error("Booking not found.");
    await updateDoc(ref,{priceApproved:action==="approve",priceResponse:action==="approve"?"Approved":"Revision requested",updatedAt:serverTimestamp()});
    toast(action==="approve"?"Price approved.":"Revision requested.");renderCustomerBookings();
  } catch(err){toast(niceError(err));}
}

if(has("staffLoginForm")) $("staffLoginForm").addEventListener("submit",async e=>{
  e.preventDefault();message("staffLoginMessage","Signing in…");
  try { await signInWithEmailAndPassword(auth,$("staffEmail").value.trim(),$("staffPassword").value); }
  catch(err){message("staffLoginMessage",niceError(err),"error");}
});
async function refreshStaffAccess(){
  if(!has("staffLoginPanel"))return;
  if(!currentUser){$("staffLoginPanel").classList.remove("hidden");$("staffApp").classList.add("hidden");return;}
  try {
    const snap=await getDoc(doc(db,"users",currentUser.uid));
    currentProfile=snap.exists()?snap.data():null;
    if(!currentProfile || !["owner","technician"].includes(currentProfile.role)){
      $("staffLoginPanel").classList.remove("hidden");$("staffApp").classList.add("hidden");
      message("staffLoginMessage","This account is not authorized for staff access. Ask the owner to authorize it.","error");return;
    }
    $("staffLoginPanel").classList.add("hidden");$("staffApp").classList.remove("hidden");
    $("staffIdentity").textContent=currentProfile.name||currentUser.email;
    $("staffRole").textContent=currentProfile.role==="owner"?"Owner":"Technician";
    $("ownerTools").classList.toggle("hidden",currentProfile.role!=="owner");
    if(currentProfile.role==="owner")loadCharges();
    await loadStaffBookings();
  }catch(err){$("staffLoginPanel").classList.remove("hidden");message("staffLoginMessage",niceError(err),"error");}
}
async function loadStaffBookings(){
  if(!has("staffBookings"))return;
  $("staffBookings").innerHTML='<div class="empty-state">Loading bookings…</div>';
  try {
    let q;
    if(currentProfile.role==="technician") q=query(collection(db,"bookings"),where("assignedTechnicianUid","==",currentUser.uid));
    else q=collection(db,"bookings");
    const snap=await getDocs(q);let items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    $("statTotal").textContent=items.length;$("statPending").textContent=items.filter(b=>b.status==="Pending").length;$("statWorking").textContent=items.filter(b=>b.status==="Working"||b.status==="Assigned").length;$("statCompleted").textContent=items.filter(b=>b.status==="Completed").length;
    if(!items.length){$("staffBookings").innerHTML='<div class="empty-state">No bookings found.</div>';return;}
    $("staffBookings").innerHTML=items.map(b=>staffBookingCard(b)).join("");
    $("staffBookings").querySelectorAll("[data-save-booking]").forEach(btn=>btn.addEventListener("click",()=>saveBookingControls(btn.dataset.saveBooking)));
    $("staffBookings").querySelectorAll("[data-assign-booking]").forEach(btn=>btn.addEventListener("click",()=>assignBooking(btn.dataset.assignBooking)));
  }catch(err){$("staffBookings").innerHTML=`<div class="empty-state">${safe(niceError(err))}</div>`;}
}
function staffBookingCard(b){
  const owner=currentProfile.role==="owner";
  const statusOpts=statuses.map(s=>`<option ${s===b.status?"selected":""}>${s}</option>`).join("");
  const price=b.proposedPrice!==null&&b.proposedPrice!==undefined?currency(b.proposedPrice):"Not proposed";
  return `<article class="booking-item"><div><h3>${safe(b.service)} <span class="pill ${(b.status||"Pending").toLowerCase()}">${safe(b.status||"Pending")}</span></h3><p>Booking: ${safe(b.id)} · Created: ${safe(dateText(b.createdAt))}</p><p><b>Customer:</b> ${safe(b.customerName)} · ${safe(b.phone)}</p><p><b>Address:</b> ${safe(b.address)}</p><p><b>Preferred:</b> ${safe(b.preferredDate)} · ${safe(b.preferredTime)}</p><p class="description"><b>Problem:</b> ${safe(b.details||"No extra details")}</p><p><b>Technician:</b> ${safe(b.assignedTechnicianName||"Not assigned")} · <b>Price:</b> ${safe(price)} · <b>Customer approval:</b> ${b.priceApproved?"Yes":"No"}</p>
  <div class="staff-booking-controls"><label>Status<select id="status-${safe(b.id)}">${statusOpts}</select></label><label>Proposed price (₹)<input id="price-${safe(b.id)}" type="number" min="0" step="1" value="${b.proposedPrice??""}" placeholder="Amount"></label><label>Work note<input id="note-${safe(b.id)}" maxlength="500" value="${safe(b.workNote||"")}" placeholder="Work update / note"></label>${owner?`<label class="full">Assign technician UID<input id="assignUid-${safe(b.id)}" value="${safe(b.assignedTechnicianUid||"")}" placeholder="Technician Firebase UID"></label><label class="full">Technician name<input id="assignName-${safe(b.id)}" value="${safe(b.assignedTechnicianName||"")}" placeholder="Technician name"></label><button class="small-btn full" data-assign-booking="${safe(b.id)}">Assign technician</button>`:""}<button class="primary-btn full" data-save-booking="${safe(b.id)}">Save booking update</button></div></div></article>`;
}
async function saveBookingControls(id){
  try{
    const status=$("status-"+id).value, priceText=$("price-"+id).value, note=$("note-"+id).value.trim();
    const update={status,workNote:note,updatedAt:serverTimestamp(),updatedBy:currentUser.uid};
    if(priceText!==""){const n=Number(priceText);if(!Number.isFinite(n)||n<0)throw new Error("Enter a valid non-negative price.");update.proposedPrice=n;update.priceApproved=false;update.priceResponse="Awaiting customer response";}
    else update.proposedPrice=null;
    await updateDoc(doc(db,"bookings",id),update);toast("Booking updated.");await loadStaffBookings();
  }catch(err){toast(niceError(err));}
}
async function assignBooking(id){
  try{
    const uid=$("assignUid-"+id).value.trim(),name=$("assignName-"+id).value.trim();
    if(!uid||!name)throw new Error("Enter technician UID and name.");
    const tech=await getDoc(doc(db,"users",uid));
    if(!tech.exists()||tech.data().role!=="technician")throw new Error("This UID is not an authorized technician. Authorize them first.");
    await updateDoc(doc(db,"bookings",id),{assignedTechnicianUid:uid,assignedTechnicianName:name,status:"Assigned",updatedAt:serverTimestamp(),updatedBy:currentUser.uid});
    toast("Technician assigned.");await loadStaffBookings();
  }catch(err){toast(niceError(err));}
}
if(has("staffRefresh"))$("staffRefresh").addEventListener("click",loadStaffBookings);
if(has("technicianForm"))$("technicianForm").addEventListener("submit",async e=>{
  e.preventDefault();message("techMessage","Saving technician…");
  try{
    if(currentProfile?.role!=="owner")throw new Error("Owner permission required.");
    const uid=$("techUid").value.trim(),email=$("techEmail").value.trim(),name=$("techName").value.trim();
    await setDoc(doc(db,"users",uid),{uid,email,name,role:"technician",createdAt:serverTimestamp(),authorizedBy:currentUser.uid});
    message("techMessage","Technician authorized successfully.","success");$("technicianForm").reset();
  }catch(err){message("techMessage",niceError(err),"error");}
});
const defaultCharges={"Motor Repair & Winding":500,"Farata Fan Winding":250,"Ceiling Fan Winding":250,"House Wiring & Fault Solution":300,"Wall Fitting & Installation":200,"All Electrical Works":300};
async function loadCharges(){
  try{
    const snap=await getDoc(doc(db,"settings","serviceCharges"));const c=snap.exists()?snap.data():defaultCharges;
    $("chargeMotor").value=c["Motor Repair & Winding"]??500;$("chargeFan").value=c["Farata Fan Winding"]??250;$("chargeWiring").value=c["House Wiring & Fault Solution"]??300;
  }catch(e){console.warn(e);}
}
if(has("chargesForm"))$("chargesForm").addEventListener("submit",async e=>{
  e.preventDefault();message("chargesMessage","Saving…");
  try{
    if(currentProfile?.role!=="owner")throw new Error("Owner permission required.");
    await setDoc(doc(db,"settings","serviceCharges"),{"Motor Repair & Winding":Number($("chargeMotor").value),"Farata Fan Winding":Number($("chargeFan").value),"Ceiling Fan Winding":Number($("chargeFan").value),"House Wiring & Fault Solution":Number($("chargeWiring").value),"Wall Fitting & Installation":Number($("chargeWiring").value),"All Electrical Works":Number($("chargeWiring").value),updatedAt:serverTimestamp(),updatedBy:currentUser.uid});
    message("chargesMessage","Service charges saved.","success");
  }catch(err){message("chargesMessage",niceError(err),"error");}
});
