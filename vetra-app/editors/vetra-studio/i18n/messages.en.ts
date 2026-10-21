/** English message catalogue; the source of truth for every key. */
export const en = {
  "idea.heading": "What do you want to build?",
  "idea.placeholder":
    "Describe your product in a sentence or two — who it's for and what they do with it.",
  "idea.inputLabel": "Your idea",
  "idea.build": "Build it",
  "idea.starting": "Starting…",
  "idea.spend": "{amount} to spend",
  "idea.example.breakfast": "Hotel breakfast orders",
  "idea.example.maintenance": "Maintenance requests",
  "idea.example.invoices": "Invoice approvals",
  "idea.startFailed": "Your build couldn't start.",
  "idea.tryAgain": "Try again",
  "idea.understand": "Show me what you understood",
  "material.notice": "Your files are read by the AI model this Studio uses.",
  "material.add": "Add a diagram, photo or sheet",
  "material.rows": "{rows} rows",
  "material.reading": "Reading…",
  "material.remove": "Remove {name}",
  "material.dropHere": "Drop to add your files",
  "material.tooLarge": "That file is larger than 15 MB.",
  "material.unsupported": "This kind of file can't be read yet.",
  "material.failed": "That file couldn't be added. Try again.",
  "material.owner": "Sign in as the Studio owner to add files.",
  "material.signIn": "Sign in to add files",
  "account.label": "Account",
  "account.settings": "Settings",
  "account.signIn": "Sign in",
  "account.signOut": "Sign out",
  "account.language": "Language",
} as const;

export type MessageKey = keyof typeof en;
