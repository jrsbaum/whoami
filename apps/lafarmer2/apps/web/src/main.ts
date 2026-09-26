import {
  HAIRS,
  OUTFITS,
  itemDisplayName,
  type Clothing,
  type HairStyle,
  type Quality,
  type Specialization
} from "@lafarmer2/content";
import { nextScreenAfterAuth, type AppScreen, type AuthMode } from "./next-screen";
import {
  RealtimeClient,
  buildStructure,
  buyListing,
  buyOriginOffer,
  createListing,
  getLandOptions,
  getMarket,
  getMe,
  getOriginShop,
  getWallet,
  getWorldOverview,
  login,
  register,
  reserveRegion,
  updateAppearance,
  updateProfile,
  type LandOption,
  type MarketListing,
  type PlayerProfile,
  type ServerPlayer,
  type WalletEntry,
  type WorldOverviewRegion,
  type WorldPresence
} from "./network";
import "./styles.css";
import { WorldView } from "./world/WorldView";
import { mountCharacterPreview } from "./world/preview";

const root = document.querySelector<HTMLDivElement>("#app")!;
const realtime = new RealtimeClient();
let mode: AuthMode = "login";
let screen: AppScreen = "auth";
let justRegistered = false;
let draft = { nick: "", password: "" };
let authToken = "";
let playerId = "";
let currentRegionId = "";
let coins = 1_000;
let inventory: Record<string, number> = {};
let inventoryQualities: Record<string, Partial<Record<Quality, number>>> = {};
let profile: PlayerProfile = { nick: "", name: "", farmName: "", specialization: null, plotId: "", outfit: "forest", hair: "short" };
let landOptions: LandOption[] = [];
let selectedLandId = "";
let selectedSpecialization: Specialization = "vegetables";
let onboardingStep = 1;
let worldOverview: WorldOverviewRegion[] = [];
let livePresence: WorldPresence[] = [];
let world: WorldView | undefined;
let previewDispose: (() => void) | undefined;
let walletEntries: WalletEntry[] = [];

const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character] || character));

const specializationLabel = (value: PlayerProfile["specialization"]): string =>
  value === "fruits" ? "frutas" : value === "dinosaurs" ? "dinossauros" : value === "vegetables" ? "legumes" : "sem especialização";

const qualityLabel = (value: Quality): string => (value === "perfect" ? "perfeita" : value === "good" ? "boa" : "comum");

const inventoryTotal = (): number => Object.values(inventory).reduce((total, quantity) => total + quantity, 0);

const applyPlayer = (player: ServerPlayer): void => {
  playerId = player.id;
  profile.name = player.name;
  profile.farmName = player.farmName || "";
  profile.specialization = player.specialization;
  profile.plotId = player.plot?.id || player.homeRegionId || "";
  profile.outfit = player.appearance.clothing;
  profile.hair = player.appearance.hair;
  selectedLandId = profile.plotId;
  selectedSpecialization = player.specialization || "vegetables";
  coins = player.coins;
  inventory = player.inventory || {};
  currentRegionId = player.currentRegionId ?? player.homeRegionId ?? profile.plotId;
};

const render = (): void => {
  previewDispose?.();
  previewDispose = undefined;
  if (screen !== "game") {
    world?.dispose();
    world = undefined;
  }
  if (screen === "auth") renderAuth();
  else if (screen === "confirm") renderConfirm();
  else if (screen === "onboarding") renderOnboarding();
  else renderGame();
};

const renderAuth = (): void => {
  root.innerHTML = `<main class="min-h-screen grid lg:grid-cols-[1.1fr_0.9fr] bg-[radial-gradient(circle_at_20%_10%,#3f6b3a,transparent_42%),linear-gradient(160deg,#10261f,#1c3d32)]">
    <section class="px-8 py-12 lg:px-16 flex flex-col justify-end">
      <p class="uppercase tracking-[0.35em] text-grass text-sm">vale compartilhado · volume dois</p>
      <h1 class="font-display text-6xl lg:text-8xl leading-none mt-4">La <span class="text-amber">Farmer</span> 2</h1>
      <p class="mt-6 max-w-xl text-lg text-cream/85">O chão agora tem profundidade. Plante no tile à frente, visite pelo portão certo e negocie no mercadinho de verdade.</p>
    </section>
    <section class="m-4 lg:m-8 bg-cream text-ink shadow-slat rounded-sm p-8" aria-label="Acesso ao vale">
      <h2 class="font-display text-3xl">${mode === "login" ? "Volte para o vale" : "Abra sua porteira"}</h2>
      <p class="mt-2 text-ink/70">${mode === "login" ? "Entre com o nick que você guardou." : "Crie um nick e anote a senha. Não há recuperação."}</p>
      <div class="flex gap-2 mt-6" role="tablist" aria-label="Acesso">
        <button type="button" class="flex-1 py-2 ${mode === "login" ? "bg-ink text-cream" : "border border-ink/20"}" data-mode="login" role="tab" aria-selected="${mode === "login"}">Entrar</button>
        <button type="button" class="flex-1 py-2 ${mode === "create" ? "bg-ink text-cream" : "border border-ink/20"}" data-mode="create" role="tab" aria-selected="${mode === "create"}">Criar nick</button>
      </div>
      <form id="auth-form" class="mt-6 space-y-4" novalidate>
        <div><label class="block text-sm" for="nick">Seu nick</label><input id="nick" name="nick" class="w-full mt-1 border border-ink/25 bg-white px-3 py-2" maxlength="20" required autocomplete="username" value="${escapeHtml(draft.nick)}"></div>
        <div><label class="block text-sm" for="password">Sua senha</label><input id="password" name="password" type="password" class="w-full mt-1 border border-ink/25 bg-white px-3 py-2" minlength="8" required autocomplete="${mode === "login" ? "current-password" : "new-password"}"></div>
        <p class="text-sm text-ink/60">Mínimo de 8 caracteres. Sem e-mail, sem recuperação.</p>
        <p id="auth-error" class="text-coral min-h-6" role="alert"></p>
        <button class="w-full bg-moss text-cream py-3 font-bold" type="submit">${mode === "login" ? "Entrar no vale" : "Criar e continuar"}</button>
      </form>
    </section>
  </main>`;
  root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.addEventListener("click", () => { mode = button.dataset.mode as AuthMode; render(); }));
  root.querySelector<HTMLFormElement>("#auth-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const nick = String(form.get("nick") || "").trim();
    const password = String(form.get("password") || "");
    const error = root.querySelector<HTMLParagraphElement>("#auth-error")!;
    if (!/^[\p{L}0-9][\p{L}0-9_-]{2,19}$/u.test(nick)) { error.textContent = "Use de 3 a 20 caracteres, sem espaços."; return; }
    if (password.length < 8) { error.textContent = "A senha precisa ter pelo menos 8 caracteres."; return; }
    draft = { nick, password };
    error.textContent = "Conectando…";
    try {
      justRegistered = mode === "create";
      const result = justRegistered ? await register(nick, password) : await login(nick, password);
      authToken = result.token;
      profile.nick = nick;
      applyPlayer(result.player);
      screen = nextScreenAfterAuth(justRegistered, result.player);
      if (screen === "onboarding") onboardingStep = 1;
      render();
    } catch (requestError) {
      error.textContent = requestError instanceof Error && requestError.message === "nick_taken" ? "Esse nick já está ocupado." : "Não foi possível entrar. Confira os dados e o servidor.";
    }
  });
};

const renderConfirm = (): void => {
  root.innerHTML = `<main class="min-h-screen grid place-items-center bg-ink px-4">
    <section class="max-w-lg w-full bg-cream text-ink p-8 shadow-slat" aria-labelledby="confirm-title">
      <p class="uppercase tracking-[0.3em] text-sm text-moss">antes de entrar</p>
      <h2 id="confirm-title" class="font-display text-4xl mt-2">Guarde seu acesso.</h2>
      <p class="mt-3">O La Farmer 2 não recupera senha. Se ela se perder, esta conta some com ela.</p>
      <div class="mt-6 border-2 border-dashed border-ink/30 p-4"><strong>${escapeHtml(draft.nick)}</strong><p class="text-sm">Anote a senha digitada agora.</p></div>
      <label class="flex gap-3 mt-6 items-start"><input id="saved-credentials" type="checkbox"><span>Guardei nick e senha e entendo que não haverá recuperação.</span></label>
      <div class="flex gap-3 mt-6">
        <button id="back-auth" class="flex-1 border border-ink/30 py-3" type="button">Voltar</button>
        <button id="confirm-access" class="flex-1 bg-moss text-cream py-3" type="button" disabled>Continuar</button>
      </div>
    </section>
  </main>`;
  const checkbox = root.querySelector<HTMLInputElement>("#saved-credentials")!;
  const continueButton = root.querySelector<HTMLButtonElement>("#confirm-access")!;
  checkbox.addEventListener("change", () => { continueButton.disabled = !checkbox.checked; });
  root.querySelector("#back-auth")!.addEventListener("click", () => { screen = "auth"; render(); });
  continueButton.addEventListener("click", () => { screen = "onboarding"; onboardingStep = 1; render(); });
};

const renderOnboarding = (): void => {
  const steps = ["Conheça o mundo", "Escolha onde morar", "Sua especialização", "Crie sua identidade"];
  const selected = worldOverview.find((region) => region.id === selectedLandId);
  const regionButtons = worldOverview.map((region) => `<button type="button" class="text-left px-3 py-2 border ${selectedLandId === region.id ? "bg-ink text-cream" : "border-ink/20"}" data-region="${escapeHtml(region.id)}" ${region.status === "frontier" && onboardingStep === 2 ? "" : "disabled"} aria-pressed="${selectedLandId === region.id}">${escapeHtml(region.name)} · ${region.status === "locked" ? "bloqueada" : region.status === "occupied" ? `ocupada por ${region.occupiedBy || "alguém"}` : "fronteira"}</button>`).join("");
  const map = worldOverview.length
    ? `<div class="grid sm:grid-cols-2 gap-2" role="group" aria-label="Mapa-múndi do vale">${regionButtons}</div>`
    : `<p>Desenhando a cartografia do vale…</p>`;
  const content = onboardingStep === 1
    ? `<p>O vale é permanente. Terras ocupadas ficam visíveis; novas nascem na fronteira.</p>${map}`
    : onboardingStep === 2
      ? `<p>Escolha uma região livre. Cada uma tem uma única conexão autorizada.</p>${map}${selected ? `<aside class="mt-4 border border-ink/15 p-4"><h3 class="font-display text-2xl">${escapeHtml(selected.name)}</h3><p>${escapeHtml(selected.summary)}</p><p class="text-sm mt-2">${escapeHtml(selected.biome)} · ${escapeHtml(selected.feature)}</p></aside>` : ""}`
      : onboardingStep === 3
        ? `<p>A especialização da fazenda principal é definitiva. O mercado ainda troca de tudo.</p>
           <div class="grid gap-3">${(["fruits", "vegetables", "dinosaurs"] as Specialization[]).map((item) => `<button type="button" class="text-left p-4 border ${selectedSpecialization === item ? "bg-ink text-cream" : "border-ink/20"}" data-specialization="${item}" aria-pressed="${selectedSpecialization === item}"><strong>${item === "fruits" ? "Frutas" : item === "vegetables" ? "Legumes" : "Dinossauros"}</strong><span class="block text-sm opacity-80">${item === "fruits" ? "Mudas e ciclos longos." : item === "vegetables" ? "Sementes e colheita rápida." : "Ovos, fósseis, ração e curral."}</span></button>`).join("")}</div>`
        : `<p>Nome no mundo. Roupa e cabelo são só expressão.</p>
           <div class="grid sm:grid-cols-2 gap-4">
             <div><label for="farm-name">Nome da fazenda</label><input id="farm-name" class="w-full border border-ink/25 px-3 py-2" maxlength="32" value="${escapeHtml(profile.farmName)}"></div>
             <div><label for="character-name">Nome do personagem</label><input id="character-name" class="w-full border border-ink/25 px-3 py-2" maxlength="24" value="${escapeHtml(profile.name)}"></div>
           </div>
           <div class="mt-4 grid lg:grid-cols-[220px_1fr] gap-6 items-start">
             <div id="preview-host" class="h-64 bg-[#d7e8c8]" role="img" aria-label="Prévia 3D do personagem"></div>
             <div>
               <h3 class="font-bold">Roupa</h3>
               <div class="flex flex-wrap gap-2 mt-2">${OUTFITS.map((item) => `<button type="button" class="px-3 py-2 border ${profile.outfit === item.id ? "bg-ink text-cream" : "border-ink/20"}" data-outfit="${item.id}" aria-pressed="${profile.outfit === item.id}">${item.label}</button>`).join("")}</div>
               <h3 class="font-bold mt-4">Cabelo</h3>
               <div class="flex flex-wrap gap-2 mt-2">${HAIRS.map((item) => `<button type="button" class="px-3 py-2 border ${profile.hair === item.id ? "bg-ink text-cream" : "border-ink/20"}" data-hair="${item.id}" aria-pressed="${profile.hair === item.id}">${item.label}</button>`).join("")}</div>
             </div>
           </div>`;
  root.innerHTML = `<main class="min-h-screen bg-cream text-ink px-4 py-8">
    <section class="max-w-4xl mx-auto">
      <p class="uppercase tracking-[0.3em] text-sm text-moss">onboarding · etapa ${onboardingStep} de 4</p>
      <div class="flex flex-wrap gap-2 mt-3" aria-label="Etapas">${steps.map((step, index) => `<span class="${index + 1 === onboardingStep ? "bg-ink text-cream" : "border border-ink/20"} px-3 py-1">${index + 1} ${step}</span>`).join("")}</div>
      <h2 class="font-display text-4xl mt-6">${steps[onboardingStep - 1]}</h2>
      <div id="onboarding-content" class="mt-6 space-y-4">${content}</div>
      <p id="onboarding-error" class="text-coral min-h-6 mt-4" role="alert"></p>
      <div class="flex gap-3 mt-4">
        <button id="onboarding-back" class="px-6 py-3 border border-ink/30" type="button" ${onboardingStep === 1 ? "disabled" : ""}>Voltar</button>
        <button id="onboarding-next" class="px-6 py-3 bg-moss text-cream" type="button">${onboardingStep === 4 ? "Confirmar e entrar no vale" : "Continuar"}</button>
      </div>
    </section>
  </main>`;
  const error = root.querySelector<HTMLParagraphElement>("#onboarding-error")!;
  root.querySelector<HTMLInputElement>("#farm-name")?.addEventListener("input", (event) => { profile.farmName = (event.target as HTMLInputElement).value; });
  root.querySelector<HTMLInputElement>("#character-name")?.addEventListener("input", (event) => { profile.name = (event.target as HTMLInputElement).value; });
  if (onboardingStep === 1 && !worldOverview.length) {
    void Promise.all([getWorldOverview(authToken), getLandOptions(authToken)]).then(([overview, options]) => {
      worldOverview = overview.regions;
      landOptions = options.options;
      render();
    }).catch(() => { error.textContent = "Não foi possível carregar o mapa agora."; });
  }
  const previewHost = root.querySelector<HTMLDivElement>("#preview-host");
  if (previewHost) previewDispose = mountCharacterPreview(previewHost, profile.outfit, profile.hair);
  root.querySelectorAll<HTMLButtonElement>("[data-region]").forEach((button) => button.addEventListener("click", () => { if (onboardingStep === 2) { selectedLandId = button.dataset.region || ""; render(); } }));
  root.querySelectorAll<HTMLButtonElement>("[data-specialization]").forEach((button) => button.addEventListener("click", () => { selectedSpecialization = button.dataset.specialization as Specialization; render(); }));
  root.querySelectorAll<HTMLButtonElement>("[data-outfit]").forEach((button) => button.addEventListener("click", () => { profile.outfit = button.dataset.outfit as Clothing; render(); }));
  root.querySelectorAll<HTMLButtonElement>("[data-hair]").forEach((button) => button.addEventListener("click", () => { profile.hair = button.dataset.hair as HairStyle; render(); }));
  root.querySelector("#onboarding-back")?.addEventListener("click", () => { if (onboardingStep > 1) { onboardingStep -= 1; render(); } });
  root.querySelector("#onboarding-next")?.addEventListener("click", async () => {
    if (onboardingStep === 1) { onboardingStep = 2; render(); return; }
    if (onboardingStep === 2) {
      if (!selectedLandId) { error.textContent = "Escolha uma região disponível."; return; }
      try { await reserveRegion(authToken, selectedLandId); onboardingStep = 3; render(); }
      catch (requestError) { error.textContent = requestError instanceof Error && requestError.message === "region_reserved" ? "Essa região acabou de ser escolhida." : "Essa região não está mais disponível."; }
      return;
    }
    if (onboardingStep === 3) { onboardingStep = 4; render(); return; }
    const farmName = root.querySelector<HTMLInputElement>("#farm-name")?.value.trim() || "";
    const name = root.querySelector<HTMLInputElement>("#character-name")?.value.trim() || "";
    if (name.length < 2) { error.textContent = "Escolha um nome com pelo menos 2 caracteres."; return; }
    if (farmName.length < 2) { error.textContent = "Dê um nome para sua fazenda."; return; }
    try {
      profile.name = name;
      profile.farmName = farmName;
      profile.specialization = selectedSpecialization;
      profile.plotId = selectedLandId;
      const result = await updateProfile(authToken, profile);
      applyPlayer(result.player);
      screen = "game";
      render();
    } catch { error.textContent = "Não foi possível concluir o assentamento."; }
  });
};

const renderGame = (): void => {
  root.innerHTML = `<main class="relative h-screen overflow-hidden bg-ink" aria-label="Mundo do La Farmer 2">
    <div id="game-root" class="absolute inset-0"></div>
    <div class="pointer-events-none absolute inset-0 p-3 md:p-5 flex flex-col justify-between">
      <header class="pointer-events-auto flex flex-wrap gap-3 items-start justify-between">
        <div class="bg-cream/95 text-ink px-4 py-3 shadow-slat min-w-[220px]">
          <strong class="font-display text-2xl">${escapeHtml(profile.farmName || "Minha fazenda")}</strong>
          <p class="text-sm">${escapeHtml(profile.name)} · ${specializationLabel(profile.specialization)}</p>
        </div>
        <div class="flex flex-wrap gap-2" aria-label="Recursos">
          <div class="bg-cream text-ink px-3 py-2"><small class="block">moedas</small><strong id="coins-value">${coins.toLocaleString("pt-BR")}</strong></div>
          <div class="bg-cream text-ink px-3 py-2"><small class="block">estoque</small><strong id="inventory-value">${inventoryTotal()}</strong></div>
          <div class="bg-cream text-ink px-3 py-2"><small class="block">produção</small><strong id="production-value">0 prontos</strong></div>
          <div class="bg-cream text-ink px-3 py-2"><small class="block">hora</small><strong id="time-of-day">Meio-dia</strong></div>
          <div class="bg-cream text-ink px-3 py-2"><span id="connection-status">${realtime.status === "connected" ? "online" : "conectando"}</span></div>
        </div>
      </header>
      <div>
        <p class="bg-ink/70 text-cream inline-block px-3 py-1 text-sm mb-2"><kbd>WASD</kbd> anda com a câmera · arraste o mouse ou <kbd>Q</kbd> para girar · <kbd>espaço</kbd> correr · <kbd>E</kbd> interagir</p>
        <div class="pointer-events-auto flex flex-wrap gap-2" aria-label="Ações rápidas">
          <button id="open-origin-shop" class="bg-amber text-ink px-3 py-2 font-bold" type="button">Loja do Vale</button>
          <button id="build-enclosure" class="bg-cream text-ink px-3 py-2" type="button">Construir</button>
          <button id="open-market" class="bg-cream text-ink px-3 py-2" type="button">Mercadinho</button>
          <button id="open-map" class="bg-cream text-ink px-3 py-2" type="button">Mapa</button>
          <button id="open-inventory" class="bg-cream text-ink px-3 py-2" type="button">Inventário</button>
          <button id="open-wardrobe" class="bg-cream text-ink px-3 py-2" type="button">Guarda-roupa</button>
          <button id="open-wallet" class="bg-cream text-ink px-3 py-2" type="button">Carteira</button>
        </div>
        <p id="action-message" class="mt-2 bg-cream/90 text-ink px-3 py-2 max-w-xl" role="status" aria-live="polite"></p>
        <p id="hud-bottom-message" class="mt-1 text-cream/90 text-sm">Chegue perto de uma produção para ver seu estado.</p>
        <div class="pointer-events-auto mt-3 w-40 grid grid-cols-3 gap-1 md:hidden" aria-label="Controles de movimento">
          <span></span><button type="button" class="bg-cream text-ink py-3" data-direction="up" aria-label="Andar para frente">↑</button><span></span>
          <button type="button" class="bg-cream text-ink py-3" data-direction="left" aria-label="Andar para a esquerda da tela">←</button>
          <button type="button" class="bg-cream text-ink py-3" data-direction="down" aria-label="Andar para trás">↓</button>
          <button type="button" class="bg-cream text-ink py-3" data-direction="right" aria-label="Andar para a direita da tela">→</button>
        </div>
      </div>
    </div>
    <section id="dialog-host"></section>
  </main>`;

  const message = (text: string): void => {
    const target = root.querySelector<HTMLParagraphElement>("#action-message");
    if (target) target.textContent = text;
  };
  const refreshHud = (): void => {
    root.querySelector("#coins-value")!.textContent = coins.toLocaleString("pt-BR");
    root.querySelector("#inventory-value")!.textContent = String(inventoryTotal());
    world?.setInventory(inventory);
  };

  void realtime.connect(authToken).then((status) => {
    const label = root.querySelector("#connection-status");
    if (label) label.textContent = status === "connected" ? "online" : "modo local";
  });

  world = new WorldView(root.querySelector("#game-root")!, {
    realtime,
    appearance: { clothing: profile.outfit, hair: profile.hair },
    name: profile.name,
    inventory,
    onCoins: (value) => { coins = value; refreshHud(); },
    onInventory: (value, qualities) => { inventory = value; if (qualities) inventoryQualities = qualities as Record<string, Partial<Record<Quality, number>>>; refreshHud(); },
    onProduction: (ready) => { const target = root.querySelector("#production-value"); if (target) target.textContent = `${ready} prontos`; },
    onPresence: (presence) => { livePresence = presence; },
    onSnapshot: (snapshot) => {
      const player = snapshot.player as ServerPlayer | undefined;
      if (player) applyPlayer(player);
      refreshHud();
    },
    onMarket: () => { void openMarketPanel(); },
    onConnectionPrompt: (text) => { const target = root.querySelector("#hud-bottom-message"); if (target) target.textContent = text || "Chegue perto de uma produção para ver seu estado."; },
    onMessage: message,
    onTime: (label) => { const target = root.querySelector("#time-of-day"); if (target) target.textContent = label; }
  });

  root.querySelector("#open-origin-shop")?.addEventListener("click", () => { void openShopPanel(); });
  root.querySelector("#open-market")?.addEventListener("click", () => { void openMarketPanel(); });
  root.querySelector("#open-map")?.addEventListener("click", () => { void openMapPanel(); });
  root.querySelector("#open-inventory")?.addEventListener("click", () => { openInventoryPanel(); });
  root.querySelector("#open-wardrobe")?.addEventListener("click", () => { void openWardrobePanel(); });
  root.querySelector("#open-wallet")?.addEventListener("click", () => { void openWalletPanel(); });
  root.querySelector("#build-enclosure")?.addEventListener("click", () => { void openBuildPanel(); });
};

const openBuildPanel = async (): Promise<void> => {
  const options = profile.specialization === "dinosaurs"
    ? [{ type: "dinosaur_enclosure", label: "Recinto de dinossauro · 500" }, { type: "animal_pen", label: "Curral da vaca · 300" }]
    : profile.specialization === "fruits"
      ? [{ type: "orchard", label: "Pomar · 150" }]
      : [{ type: "field", label: "Campo · 100" }];
  const body = openDialog("Construir", `<p>A estrutura nasce ao lado do fazendeiro e já aparece no vale.</p><div class="mt-3 grid gap-2">${options.map((option) => `<button type="button" class="text-left border border-ink/20 px-3 py-2" data-type="${option.type}">${option.label}</button>`).join("")}</div><p id="build-status" class="mt-3" role="status"></p>`);
  body.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((button) => button.addEventListener("click", async () => {
    const status = body.querySelector("#build-status")!;
    try {
      const built = await buildStructure(authToken, button.dataset.type || "field");
      world?.applyStructure(built.structure);
      const me = await getMe(authToken);
      applyPlayer(me.player);
      root.querySelector("#coins-value")!.textContent = coins.toLocaleString("pt-BR");
      status.textContent = "Construído. A malha já está no chão.";
    } catch (error) {
      status.textContent = error instanceof Error && error.message === "insufficient_coins" ? "Faltam moedas." : "Não dá para construir neste tile.";
    }
  }));
};

const openDialog = (title: string, body: string): HTMLElement => {
  const host = root.querySelector("#dialog-host")!;
  host.innerHTML = `<div class="absolute inset-0 bg-ink/50 grid place-items-center p-4 z-20">
    <section class="bg-cream text-ink max-w-xl w-full max-h-[85vh] overflow-auto p-6 shadow-slat" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="flex justify-between gap-4 items-start"><h2 class="font-display text-3xl">${escapeHtml(title)}</h2><button type="button" class="dialog-close border border-ink/20 px-3 py-1" aria-label="Fechar">Fechar</button></div>
      <div class="dialog-body mt-4">${body}</div>
    </section>
  </div>`;
  host.querySelector(".dialog-close")?.addEventListener("click", () => { host.innerHTML = ""; });
  return host.querySelector(".dialog-body") as HTMLElement;
};

const openShopPanel = async (): Promise<void> => {
  const body = openDialog("Loja do Vale", `<p id="shop-status">Carregando…</p><div id="shop-list" class="space-y-2"></div>`);
  try {
    const result = await getOriginShop(authToken);
    const status = body.querySelector("#shop-status")!;
    const list = body.querySelector("#shop-list")!;
    status.textContent = result.offers.length ? "Só o que a sua especialização produz." : "Nenhuma oferta.";
    result.offers.forEach((offer) => {
      const row = document.createElement("article");
      row.className = "flex justify-between gap-3 border border-ink/15 p-3";
      row.innerHTML = `<div><strong>${escapeHtml(offer.displayName)}</strong><p class="text-sm">${offer.kind} · ${offer.cost} moedas</p></div><button type="button" class="bg-moss text-cream px-3">Comprar</button>`;
      row.querySelector("button")?.addEventListener("click", async () => {
        try {
          const bought = await buyOriginOffer(authToken, offer.id);
          coins = bought.coins;
          inventory = bought.inventory;
          world?.setInventory(inventory);
          root.querySelector("#coins-value")!.textContent = coins.toLocaleString("pt-BR");
          root.querySelector("#inventory-value")!.textContent = String(inventoryTotal());
          await openShopPanel();
        } catch { status.textContent = "Não foi possível comprar."; }
      });
      list.append(row);
    });
  } catch {
    body.textContent = "Loja indisponível.";
  }
};

const openMarketPanel = async (): Promise<void> => {
  const body = openDialog("Mercadinho do vale", `<p id="market-status">Carregando…</p><div id="market-list" class="space-y-3"></div>`);
  try {
    const result = await getMarket();
    const status = body.querySelector("#market-status")!;
    const list = body.querySelector("#market-list")!;
    status.textContent = result.listings.length ? `${result.listings.length} anúncio(s)` : "Ninguém anunciou ainda.";
    const sellable = Object.entries(inventory).filter(([, quantity]) => quantity > 0);
    if (sellable.length) {
      const form = document.createElement("form");
      form.className = "border border-ink/20 p-3 space-y-2";
      form.innerHTML = `<h3 class="font-bold">Anunciar</h3>
        <label>Item<select name="contentId" class="w-full border px-2 py-1">${sellable.map(([id, quantity]) => `<option value="${escapeHtml(id)}">${escapeHtml(itemDisplayName(id))} (${quantity})</option>`).join("")}</select></label>
        <label>Quantidade<input name="quantity" type="number" min="1" value="1" class="w-full border px-2 py-1"></label>
        <label>Preço unitário<input name="unitPrice" type="number" min="1" value="30" class="w-full border px-2 py-1"></label>
        <button class="bg-ink text-cream px-3 py-2" type="submit">Publicar</button>`;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        try {
          await createListing(authToken, String(data.get("contentId")), Number(data.get("quantity")), Number(data.get("unitPrice")));
          const me = await getMe(authToken);
          inventory = me.player.inventory || {};
          world?.setInventory(inventory);
          await openMarketPanel();
        } catch { status.textContent = "Não foi possível anunciar."; }
      });
      list.append(form);
    }
    result.listings.forEach((listing: MarketListing) => {
      const row = document.createElement("article");
      row.className = "flex justify-between gap-3 border border-ink/15 p-3";
      row.innerHTML = `<div><strong>${escapeHtml(itemDisplayName(listing.contentId))}</strong><p class="text-sm">${listing.quantity} · ${listing.unitPrice} moedas · ${qualityLabel((listing.quality ?? "common") as Quality)} · ${escapeHtml(listing.sellerName)}</p></div><button type="button" class="bg-moss text-cream px-3">Comprar</button>`;
      row.querySelector("button")?.addEventListener("click", async () => {
        try {
          const purchased = await buyListing(authToken, listing.id);
          coins = purchased.coins;
          inventory = purchased.inventory;
          world?.setInventory(inventory);
          root.querySelector("#coins-value")!.textContent = coins.toLocaleString("pt-BR");
          await openMarketPanel();
        } catch (error) {
          status.textContent = error instanceof Error && error.message === "cannot_buy_own_listing" ? "Você não compra o próprio anúncio." : "Compra recusada.";
        }
      });
      list.append(row);
    });
  } catch {
    body.textContent = "Mercadinho indisponível.";
  }
};

const openInventoryPanel = (): void => {
  const rows = Object.entries(inventory).filter(([, quantity]) => quantity > 0);
  const html = rows.length
    ? rows.map(([id, quantity]) => {
      const qualities = inventoryQualities[id] ?? {};
      const detail = (["perfect", "good", "common"] as Quality[]).map((quality) => qualities[quality] ? `${qualities[quality]} ${qualityLabel(quality)}` : "").filter(Boolean).join(" · ");
      return `<li class="border border-ink/15 p-3"><strong>${escapeHtml(itemDisplayName(id))}</strong><span class="block text-sm">${quantity} no estoque${detail ? ` · ${detail}` : " · qualidade comum"}</span></li>`;
    }).join("")
    : "<p>Estoque vazio. Compre na Loja do Vale ou colha.</p>";
  openDialog("Inventário", `<ul class="space-y-2">${html}</ul>`);
};

const openWardrobePanel = async (): Promise<void> => {
  const body = openDialog("Guarda-roupa", `<p>Troca só roupa e cabelo. Terra e especialização ficam onde estão.</p>
    <div class="flex flex-wrap gap-2 mt-3">${OUTFITS.map((item) => `<button type="button" class="px-3 py-2 border" data-outfit="${item.id}">${item.label}</button>`).join("")}</div>
    <div class="flex flex-wrap gap-2 mt-3">${HAIRS.map((item) => `<button type="button" class="px-3 py-2 border" data-hair="${item.id}">${item.label}</button>`).join("")}</div>
    <p id="wardrobe-status" class="mt-3" role="status"></p>`);
  const save = async (): Promise<void> => {
    try {
      const result = await updateAppearance(authToken, profile.name, profile.outfit, profile.hair);
      applyPlayer(result.player);
      world?.applyAppearance(profile.outfit, profile.hair);
      body.querySelector("#wardrobe-status")!.textContent = "Visual atualizado.";
    } catch {
      body.querySelector("#wardrobe-status")!.textContent = "Não foi possível trocar o visual.";
    }
  };
  body.querySelectorAll<HTMLButtonElement>("[data-outfit]").forEach((button) => button.addEventListener("click", () => { profile.outfit = button.dataset.outfit as Clothing; void save(); }));
  body.querySelectorAll<HTMLButtonElement>("[data-hair]").forEach((button) => button.addEventListener("click", () => { profile.hair = button.dataset.hair as HairStyle; void save(); }));
};

const openWalletPanel = async (): Promise<void> => {
  const body = openDialog("Carteira", `<p id="wallet-status">Carregando histórico…</p><ol id="wallet-list" class="space-y-2"></ol>`);
  try {
    walletEntries = (await getWallet(authToken)).entries;
    body.querySelector("#wallet-status")!.textContent = `${coins.toLocaleString("pt-BR")} moedas agora. Offline rende ao voltar; online enquanto o vale estiver conectado.`;
    body.querySelector("#wallet-list")!.innerHTML = walletEntries.slice().reverse().slice(0, 20).map((entry) =>
      `<li class="border border-ink/15 p-2"><strong>${entry.delta > 0 ? "+" : ""}${entry.delta}</strong> · ${escapeHtml(walletReason(entry.reason))} · saldo ${entry.balance}</li>`
    ).join("");
  } catch {
    body.querySelector("#wallet-status")!.textContent = "Carteira indisponível.";
  }
};

const openMapPanel = async (): Promise<void> => {
  if (!worldOverview.length) {
    try { worldOverview = (await getWorldOverview(authToken)).regions; } catch { openDialog("Mapa do mundo", "<p>Não foi possível carregar o mapa.</p>"); return; }
  }
  const region = worldOverview.find((candidate) => candidate.id === currentRegionId || candidate.id === profile.plotId);
  const neighborIds = new Set(region?.neighbors ?? []);
  const neighbors = livePresence.filter((presence) => presence.id !== playerId && neighborIds.has(presence.currentRegionId ?? presence.homeRegionId ?? ""));
  const regions = worldOverview.map((item) => `<li class="border border-ink/15 p-2 ${item.id === currentRegionId ? "bg-ink text-cream" : ""}"><strong>${escapeHtml(item.name)}</strong><span class="block text-sm">${item.status === "frontier" ? "fronteira" : item.status === "occupied" ? `ocupada${item.occupiedBy ? ` por ${item.occupiedBy}` : ""}` : "bloqueada"}</span></li>`).join("");
  const people = neighbors.length
    ? neighbors.map((person) => `<li>${escapeHtml(person.name)} · ${person.online ? "online" : "fora"} · ${escapeHtml(person.farmName || "fazenda vizinha")}</li>`).join("")
    : "<li>Nenhum vizinho conectado agora. Visita só pela porteira, ponte ou passagem, e só se alguém ocupar o destino.</li>";
  openDialog("Mapa-múndi", `<ul class="grid sm:grid-cols-2 gap-2">${regions}</ul><h3 class="font-bold mt-4">Vizinhança</h3><ul class="mt-2 space-y-1">${people}</ul>`);
};

const walletReason = (reason: string): string => {
  if (reason === "offline_reward") return "recompensa offline";
  if (reason === "online_reward") return "tick online";
  if (reason === "starting_balance") return "saldo inicial";
  if (reason === "market_purchase") return "compra no mercadinho";
  if (reason === "market_sale") return "venda no mercadinho";
  if (reason === "plant") return "loja ou construção";
  return reason;
};

render();
