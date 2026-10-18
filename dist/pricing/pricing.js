(async()=>{
  const paypal=document.getElementById('payPaypal'),notice=document.getElementById('checkoutStatus');
  try {
    const response=await fetch('/api/account',{credentials:'same-origin'});
    if(!response.ok)return;
    const state=await response.json();
    for(const [button,ready,provider] of [[paypal,state.paypalReady,'paypal']]) {
      button.disabled=!ready;
      if(ready)button.addEventListener('click',()=>location.assign(`/account/?payment=${provider}`));
    }
    if(state.stripeReady||state.paypalReady){
      notice.textContent='Sign in to subscribe. US$4.99/month for 10 conversions. Cancel future renewals from your account.';
      
    }
  } catch { /* Keep checkout disabled until the server confirms availability. */ }
})();
