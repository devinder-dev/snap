/**
 * All Swedish UI copy, in one place.
 *
 * The point is not i18n — it is auditability. The assignment binds us to render the
 * backend's English `message` verbatim. Keeping every Swedish string here makes the
 * boundary reviewable at a glance: anything in this file is ours, anything rendered
 * from `ApiError.message` is the backend's, and the two only ever meet as two
 * separate lines inside <ErrorBanner>.
 *
 * Never interpolate an API message into one of these strings.
 */
export const S = {
  common: {
    cancel: 'Avbryt',
    close: 'Stäng',
    back: 'Tillbaka',
    retry: 'Försök igen',
    done: 'Klart',
    delete: 'Ta bort',
    loading: 'Laddar…',
    openSettings: 'Öppna inställningar',
    somethingWentWrong: 'Något gick fel',
    checkConnection: 'Kontrollera din internetanslutning och försök igen.',
    search: 'Sök',
  },

  /** Shared between login and register so the two forms cannot drift apart. */
  fields: {
    usernameLabel: 'Användarnamn',
    usernamePlaceholder: 'ditt användarnamn',
    passwordLabel: 'Lösenord',
    passwordPlaceholder: 'ditt lösenord',
  },

  login: {
    title: 'Logga in',
    subtitle: 'Logga in för att börja snappa.',
    submit: 'Logga in',
    noAccount: 'Har du inget konto?',
    goToRegister: 'Registrera dig',
    /** lead-in above a verbatim 404 / 401 from the API */
    failed: 'Inloggningen misslyckades',
  },

  register: {
    title: 'Skapa konto',
    subtitle: 'Välj ett användarnamn och ett lösenord.',
    submit: 'Skapa konto',
    hasAccount: 'Har du redan ett konto?',
    goToLogin: 'Logga in',
    /** lead-in above a verbatim 409 */
    failed: 'Kunde inte skapa kontot',
    /** lead-in above a verbatim 500 */
    serverFailed: 'Något gick fel på servern',
  },

  validation: {
    bothFields: 'Fyll i båda fälten',
    usernameRequired: 'Fyll i ett användarnamn',
  },

  password: {
    show: 'Visa lösenord',
    hide: 'Dölj lösenord',
  },

  chats: {
    title: 'Chattar',
    loading: 'Laddar vänner…',
    requestsSection: 'Nya vänförfrågningar',
    requestSubtitle: 'vill lägga till dig',
    requestAccept: 'Lägg till',
    requestAcceptA11y: 'Acceptera vänförfrågan',
    requestRejectA11y: 'Avvisa förfrågan',
    friendsSection: 'Vänner',
    pendingSection: 'Väntar på svar',
    emptyTitle: 'Inga vänner än',
    emptyBody: 'Lägg till en vän för att börja snappa.',
    emptyAction: 'Lägg till vän',
    loadFailed: 'Kunde inte hämta dina vänner',
    acceptFailed: 'Kunde inte lägga till vännen',
    snapsSection: 'Nya snaps',
    snapCount: (n: number) => (n === 1 ? 'Ny snap' : `${n} nya snaps`),
    snapRowHint: 'Tryck för att visa',
    openSnapsA11y: (u: string) => `Visa snaps från ${u}`,
    /** Last-message preview. The body is the user's own text, not an API error. */
    lastMessageMine: (body: string) => `Du: ${body}`,
  },

  friends: {
    title: 'Vänner',
    addRow: 'Lägg till vän',
    sentRequestsSection: 'Skickade förfrågningar',
    myFriendsSection: 'Mina vänner',
    emptyTitle: 'Din vänlista är tom',
    emptyBody: 'Sök upp en kompis med användarnamn.',
  },

  friend: {
    mutualSubtitle: 'Vänner',
    pendingSubtitle: 'Väntar på svar',
    pendingBadge: 'Väntar',
    deleteTitle: 'Ta bort vän?',
    deleteMessage: (u: string) => `Vill du ta bort ${u} från din vänlista?`,
    /** The backend keeps their edge, so removing a mutual friend turns them into
     *  an incoming request rather than making them vanish. Say so up front. */
    deleteMutualNote: 'De kommer att dyka upp som en ny vänförfrågan.',
    deleteConfirm: 'Ta bort',
    deleteFailed: 'Kunde inte ta bort vännen',
    cancelRequestTitle: 'Avbryt förfrågan?',
    cancelRequestMessage: (u: string) => `Vill du avbryta din vänförfrågan till ${u}?`,
    cancelRequestConfirm: 'Avbryt förfrågan',
    deleteA11yAction: 'Ta bort vän',
    openChatA11y: (u: string) => `Öppna chatt med ${u}`,
    pendingA11yHint: 'Ni måste vara vänner åt båda hållen',
  },

  addFriend: {
    title: 'Lägg till vän',
    body: 'Skriv användarnamnet på personen du vill lägga till.',
    usernameLabel: 'Användarnamn',
    usernamePlaceholder: 't.ex. kalle',
    submit: 'Lägg till',
    /** lead-in above a verbatim 400 "You can't add yourself as a friend" */
    selfLead: 'Det går inte',
    /** lead-in above a verbatim 404 "User not found" */
    notFoundLead: 'Hittade ingen användare',
    friendsTitle: 'Ni är vänner!',
    friendsBody: (u: string) => `${u} hade redan lagt till dig. Nu kan ni snappa.`,
    friendsPrimary: 'Öppna chatt',
    pendingTitle: 'Förfrågan skickad',
    pendingBody: (u: string) => `${u} måste lägga till dig tillbaka innan ni kan chatta.`,
    pendingPrimary: 'Klart',
    addMore: 'Lägg till fler',
  },

  camera: {
    shutterA11y: 'Ta bild',
    flipA11y: 'Byt kamera',
    flashOffA11y: 'Blixt av',
    flashOnA11y: 'Blixt på',
    flashAutoA11y: 'Blixt automatiskt',
    previewA11y: 'Kameravy',
    coachMark: 'Svep åt sidan för karta, chattar och vänner',
    permissionTitle: 'Kameran är avstängd',
    permissionBody: 'Snap behöver tillgång till kameran för att du ska kunna ta bilder.',
    permissionAction: 'Tillåt kamera',
    permissionDeniedBody: 'Du har nekat kameraåtkomst. Öppna inställningar för att ändra.',
    captureFailed: 'Kunde inte ta bilden',
  },

  preview: {
    discardA11y: 'Kasta bilden',
    captionToggleA11y: 'Lägg till text',
    captionPlaceholder: 'Skriv något…',
    send: 'Skicka till',
    sendA11y: 'Välj vem du vill skicka till',
  },

  sendTo: {
    title: 'Skicka till',
    searchPlaceholder: 'Sök vänner',
    clear: 'Rensa',
    selectableSection: 'Kan ta emot',
    pendingSection: 'Väntar på svar',
    pendingRowSubtitle: 'Kan inte ta emot snaps än',
    chooseRecipients: 'Välj mottagare',
    sendOne: 'Skicka till 1 vän',
    sendMany: (n: number) => `Skicka till ${n} vänner`,
    /** lead-in above a verbatim 400 "You are not friends with X" */
    sendFailed: 'Kunde inte skicka',
    sentOne: 'Skickat till 1 vän',
    sentMany: (n: number) => `Skickat till ${n} vänner`,
    emptyTitle: 'Inga vänner att skicka till',
    emptyBody: 'Du kan bara skicka till vänner som har lagt till dig tillbaka.',
    removeChipA11y: (u: string) => `Ta bort ${u} som mottagare`,
    selectA11y: (u: string) => `Välj ${u} som mottagare`,
  },

  map: {
    title: 'Karta',
    loading: 'Hämtar din position…',
    closeA11y: 'Stäng kartan',
    recenterA11y: 'Centrera på min plats',
    permissionTitle: 'Kartan behöver din plats',
    permissionBody: 'Slå på platstjänster för att se var dina vänner är.',
    permissionDeniedBody: 'Du har nekat platsåtkomst. Öppna inställningar för att ändra.',
    permissionAction: 'Försök igen',
    positionFailed: 'Kunde inte hämta din position',
    friendLastSeen: 'Senast sedd nyss',
    sendSnap: 'Skicka snap',
    youA11y: 'Din position',
    friendMarkerA11y: (u: string) => `${u} på kartan`,
    webUnavailableTitle: 'Kartan finns bara i appen',
    webUnavailableBody: 'Öppna Snap på din telefon för att se kartan.',
  },

  chat: {
    emptyTitle: 'Inga meddelanden än',
    emptyBody: (u: string) => `Säg hej till ${u}.`,
    composerPlaceholder: 'Skicka ett meddelande',
    sendA11y: 'Skicka meddelande',
    cameraA11y: 'Skicka en snap',
    friendsSubtitle: 'Vänner',
    loading: 'Laddar meddelanden…',
    loadFailed: 'Kunde inte hämta meddelandena',
    /** lead-in above a verbatim 400 "You are not friends with X" */
    sendFailed: 'Kunde inte skicka meddelandet',
    sending: 'Skickar…',
    failedBubble: 'Inte skickat · tryck för att försöka igen',
    retryA11y: 'Försök skicka igen',
    newSnaps: (n: number) => (n === 1 ? 'Ny snap · tryck för att visa' : `${n} nya snaps · tryck för att visa`),
  },

  snap: {
    loading: 'Öppnar snap…',
    closeA11y: 'Stäng snappen',
    nextA11y: 'Nästa snap',
    /** lead-in above a verbatim 404 "Snap not found" */
    openFailed: 'Snappen gick inte att öppna',
    noMedia: 'Bilden finns inte längre.',
    imageFailed: 'Bilden kunde inte laddas.',
    tapToContinue: 'Tryck för att fortsätta',
    progress: (i: number, n: number) => `Snap ${i} av ${n}`,
  },

  toast: {
    snapFrom: (u: string) => `Ny snap från ${u}`,
    friendRequest: (u: string) => `${u} vill lägga till dig`,
    friendAccepted: (u: string) => `Du och ${u} är nu vänner`,
    screenshot: (u: string) => `${u} tog en skärmdump av din snap`,
    dismissA11y: 'Stäng notisen',
  },

  time: {
    now: 'nyss',
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} tim`,
    days: (n: number) => `${n} d`,
  },

  nav: {
    map: 'Karta',
    chats: 'Chattar',
    camera: 'Kamera',
    friends: 'Vänner',
  },

  a11y: {
    avatar: (u: string) => `Profilbild för ${u}`,
    dismissBanner: 'Stäng meddelandet',
  },
} as const;
