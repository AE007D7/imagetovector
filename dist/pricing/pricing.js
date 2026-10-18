(()=>{
const notice=document.getElementById('checkoutStatus'),dialog=document.getElementById('checkoutSignIn'),form=document.getElementById('checkoutSignInForm'),signInStatus=document.getElementById('signInStatus');
const buttons=[...document.querySelectorAll('[data-provider][data-plan]')];
let selected=null,busy=false,state=null;
async function request(url,data){
 const response=await fetch(url,{method:data?'POST':'GET',credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});
 const result=await response.json();
 if(!response.ok)throw Error(result.error?.message||result.error||result.message||'Please try again.');
 return result;
}
function refreshButtons(){for(const button of buttons)button.disabled=busy||!state?.ready||!state?.[button.dataset.provider==='paypal'?'paypalReady':'stripeReady'];}
function askSignIn(){
 signInStatus.textContent='';
 document.getElementById('selectedPlan').textContent='10 conversions · US$4.99/month · '+(selected.provider==='paypal'?'PayPal':'Card');
 if(!dialog.open)dialog.showModal();
 document.getElementById('checkoutEmail').focus();
}
async function subscribe(choice){
 if(busy)return;
 if(choice.plan!=='monthly-10'||!['stripe','paypal'].includes(choice.provider)){notice.textContent='Please choose an available plan.';return;}
 selected=choice;busy=true;refreshButtons();notice.textContent='Preparing your checkout…';
 try{
  state=await request('/api/account');
  if(!state.ready||!state[choice.provider==='paypal'?'paypalReady':'stripeReady'])throw Error('This payment method is temporarily unavailable. Please choose another method or try again shortly.');
  if(!state.user){notice.textContent='Enter your email to continue with your selected subscription.';askSignIn();return;}
  const result=await request('/api/account',{action:choice.provider==='paypal'?'paypal-checkout':'checkout'});
  if(!result.url)throw Error('Checkout could not be opened. Please try again.');
  notice.textContent='Opening secure checkout…';location.assign(result.url);
 }catch(error){notice.textContent=error.message;}
 finally{busy=false;refreshButtons();}
}
for(const button of buttons)button.addEventListener('click',()=>subscribe({plan:button.dataset.plan,provider:button.dataset.provider}));
dialog.querySelector('.checkout-close').addEventListener('click',()=>dialog.close());
form.addEventListener('submit',async event=>{
 event.preventDefault();if(!selected)return;
 const button=form.querySelector('button');button.disabled=true;
 try{
  const callback='/pricing/?plan='+encodeURIComponent(selected.plan)+'&checkout='+encodeURIComponent(selected.provider);
  await request('/api/auth/sign-in/magic-link',{email:document.getElementById('checkoutEmail').value,callbackURL:callback,newUserCallbackURL:callback,errorCallbackURL:'/pricing/?signin=expired'});
  signInStatus.textContent='Check your inbox. Your sign-in link will take you straight to checkout for this plan.';
 }catch(error){signInStatus.textContent=error.message;}
 finally{button.disabled=false;}
});
(async()=>{
 try{
  state=await request('/api/account');refreshButtons();
  notice.textContent=state.stripeReady||state.paypalReady?'Choose a payment method. US$4.99/month for 10 conversions. Cancel future renewals from your account.':'Checkout is temporarily unavailable. Please try again shortly.';
  const query=new URLSearchParams(location.search),provider=query.get('checkout'),plan=query.get('plan');
  if(query.get('signin')==='expired'){notice.textContent='Your sign-in link expired or was already used. Choose a payment method to request another.';}
  if(provider&&plan){
   history.replaceState(null,'','/pricing/#monthly-10');
   await subscribe({provider,plan});
  }
 }catch(error){notice.textContent=error.message;}
})();
})();