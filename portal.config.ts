import { defineConfig } from "@portalsdk/config";

export default defineConfig({
  channels: {
    "game:*": { anonymous: true },
    "detectives:*": { anonymous: true },
    "stress:*": { anonymous: true },
    "ai-events:*": { anonymous: true },
    "game-state:*": { anonymous: true },
    "achievements:*": { anonymous: true },
    "votes:*": { anonymous: true },
  },
  webhooks: {
    url: process.env.PORTAL_WEBHOOK_URL ?? "https://sospechosos.example.com/api/portal-webhook",
  },
});
