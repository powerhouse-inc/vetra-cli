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
  "account.label": "Account",
  "account.settings": "Settings",
  "account.signIn": "Sign in",
  "account.signOut": "Sign out",
  "account.language": "Language",
} as const;

export type MessageKey = keyof typeof en;
