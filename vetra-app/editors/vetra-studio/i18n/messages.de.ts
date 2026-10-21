import type { MessageKey } from "./messages.en.js";

/** German message catalogue; an empty value falls back to English. */
export const de: Record<MessageKey, string> = {
  "idea.heading": "Was möchtest du bauen?",
  "idea.placeholder":
    "Beschreibe dein Produkt in ein bis zwei Sätzen — für wen es ist und was diese Menschen damit tun.",
  "idea.inputLabel": "Deine Idee",
  "idea.build": "Los geht's",
  "idea.starting": "Wird gestartet…",
  "idea.spend": "{amount} verfügbar",
  "idea.example.breakfast": "Frühstücksbestellungen im Hotel",
  "idea.example.maintenance": "Wartungsanfragen",
  "idea.example.invoices": "Rechnungsfreigaben",
  "idea.startFailed": "Dein Vorhaben konnte nicht gestartet werden.",
  "idea.tryAgain": "Nochmal versuchen",
  "account.label": "Konto",
  "account.settings": "Einstellungen",
  "account.signIn": "Anmelden",
  "account.signOut": "Abmelden",
  "account.language": "Sprache",
};
