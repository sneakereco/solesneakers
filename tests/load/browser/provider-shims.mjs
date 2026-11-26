export function squareShimSource() {
  return `(()=>{
 const method=()=>{const listeners=new Map();let root;return{
  async attach(selector){root=document.querySelector(selector);if(!root)throw Error('Simulated payment mount missing');root.innerHTML='<fieldset aria-label="Simulated card fields"><label>Card number<input data-load-card="cardNumber" aria-label="Simulated card number"></label><label>Expiry<input data-load-card="expirationDate" aria-label="Simulated expiry"></label><label>CVV<input data-load-card="cvv" aria-label="Simulated CVV"></label><label>ZIP<input data-load-card="postalCode" aria-label="Simulated card ZIP"></label></fieldset>';root.addEventListener('input',event=>{for(const name of ['cardBrandChanged','focusClassAdded','errorClassRemoved'])listeners.get(name)?.({detail:{field:event.target.dataset.loadCard,cardBrand:'VISA',currentState:{isEmpty:false,isCompletelyValid:true,hasErrorClass:false}}});});root.addEventListener('keydown',event=>{if(event.key==='Enter')listeners.get('submit')?.({detail:{}});});},
  addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name){listeners.delete(name);},async focus(){root?.querySelector('input')?.focus();return true;},recalculateSize(){},async destroy(){if(root)root.innerHTML='';return true;},async tokenize(){return{status:'OK',token:'load-source-approved'};}
 };};
 window.Square={payments:()=>({card:async()=>method(),paymentRequest:()=>({addEventListener(){},update:()=>true}),applePay:async()=>{throw Error('Native wallet requires bounded device coverage');},afterpayClearpay:async()=>({...method(),async attach(){},async tokenize(){return{status:'CANCEL'};}}),cashAppPay:async()=>({async attach(){},addEventListener(){},async destroy(){return true;}})})};
})();`;
}
export function turnstileShimSource(fixture) {
  if (!fixture.runId || !Number.isSafeInteger(fixture.slot))
    throw Error("Turnstile fixture scope missing");
  const token = JSON.stringify(`load-turnstile:${fixture.runId}:${fixture.slot}`);
  return `(()=>{const widgets=new Map();window.turnstile={render(element,options){const id=String(widgets.size);widgets.set(id,options);queueMicrotask(()=>options.callback(${token}));return id;},reset(id){const options=widgets.get(id);if(options)queueMicrotask(()=>options.callback(${token}));},remove(id){widgets.delete(id);}};})();`;
}
export async function installBulkProviderRoutes(context, fixture) {
  if (fixture.providerMode !== "simulated")
    throw Error("Browser SDK shims require explicit simulated mode");
  const counters = { square: 0, turnstile: 0, blockedThirdParty: 0, realThirdParty: 0 };
  const primary = fixture.supabaseUrl ? new URL(fixture.supabaseUrl).origin : null;
  if (context.routeWebSocket)
    await context.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url()),
        httpsOrigin = url.origin.replace(/^wss:/, "https:");
      if (url.protocol === "wss:" && [fixture.baseUrl, primary].includes(httpsOrigin))
        socket.connectToServer();
      else void socket.close({ code: 1008, reason: "Bulk test egress is restricted" });
    });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === fixture.baseUrl || url.origin === primary) {
      const headers = { ...route.request().headers() };
      delete headers["x-load-test-credential"];
      delete headers["x-load-test-slot"];
      if (
        url.origin === fixture.baseUrl &&
        !/^\/(?:images\/|_next\/|favicon\.ico$)/.test(url.pathname) &&
        fixture.credential
      ) {
        headers["x-load-test-credential"] = fixture.credential;
        headers["x-load-test-slot"] = String(fixture.slot);
      }
      return route.continue({ headers });
    }
    if (
      url.origin === "https://sandbox.web.squarecdn.com" &&
      url.pathname === "/v1/square.js"
    ) {
      counters.square++;
      return route.fulfill({
        contentType: "application/javascript",
        body: squareShimSource(),
      });
    }
    if (
      url.origin === "https://challenges.cloudflare.com" &&
      url.pathname === "/turnstile/v0/api.js"
    ) {
      counters.turnstile++;
      return route.fulfill({
        contentType: "application/javascript",
        body: turnstileShimSource(fixture),
      });
    }
    counters.blockedThirdParty++;
    return route.abort("blockedbyclient");
  });
  return counters;
}
