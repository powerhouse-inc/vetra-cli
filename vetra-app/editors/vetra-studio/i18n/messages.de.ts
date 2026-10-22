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
  "idea.understand": "Zeig mir, was du verstanden hast",
  "material.notice":
    "Deine Dateien werden vom KI-Modell dieses Studios gelesen.",
  "material.add": "Diagramm, Foto oder Tabelle hinzufügen",
  "material.rows": "{rows} Zeilen",
  "material.reading": "Wird gelesen…",
  "material.remove": "{name} entfernen",
  "material.dropHere": "Hier ablegen, um deine Dateien hinzuzufügen",
  "material.tooLarge": "Diese Datei ist größer als 15 MB.",
  "material.unsupported": "Diese Art von Datei kann noch nicht gelesen werden.",
  "material.failed":
    "Diese Datei konnte nicht hinzugefügt werden. Versuch es noch einmal.",
  "material.owner":
    "Melde dich als Besitzer des Studios an, um Dateien hinzuzufügen.",
  "material.signIn": "Melde dich an, um Dateien hinzuzufügen",
  "account.label": "Konto",
  "account.settings": "Einstellungen",
  "account.signIn": "Anmelden",
  "account.signOut": "Abmelden",
  "account.language": "Sprache",
  "team.menu": "Team",
  "team.heading": "Team",
  "team.close": "Schließen",
  "team.you": "du",
  "team.role.owner": "Inhaber",
  "team.role.maker": "Macher",
  "team.role.viewer": "Betrachter",
  "team.role.guest": "Gast",
  "team.reviewer": "Prüfer",
  "team.agentAllowed": "Agent erlaubt",
  "team.needsAllow": "Erlaube dem Agenten, für dich zu arbeiten",
  "team.limited":
    "Dieses Studio sieht die Mitglieder, die es geöffnet haben. Die vollständige Mitgliederliste der Organisation ist hier nicht verfügbar.",
  "team.unavailable": "Das Team ist gerade nicht verfügbar.",
  "team.pending":
    "Die Team-Einstellungen dieses Studios werden noch eingerichtet.",
  "team.onlyWatch": "Kann hier nur zuschauen",
  "team.actionFailed":
    "Das konnte nicht geändert werden. Versuch es noch einmal.",
  "team.viewerSteer":
    "Du kannst zuschauen und kommentieren. Frag einen Inhaber, wenn du Änderungen machen möchtest.",
  "team.move.heading": "In eine Organisation verschieben",
  "team.move.choose": "Organisation wählen",
  "team.move.explainer":
    "Verschiebt dieses Studio und sein verbleibendes Budget zu {org}. Mitglieder von {org} erhalten Zugriff nach ihrer Rolle.",
  "team.move.button": "Zu {org} verschieben",
  "team.move.noOrgs": "Du besitzt noch keine Organisation.",
  "team.move.unavailable":
    "Das Verschieben eines Studios in eine Organisation ist hier noch nicht verfügbar.",
  "team.move.failed":
    "Dieses Studio konnte nicht verschoben werden. Versuch es noch einmal.",
  "team.move.done": "Dieses Studio gehört jetzt zu {org}.",
};
