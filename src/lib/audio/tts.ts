/**
 * Text-to-Speech wrapper — Web Speech API.
 *
 * The suspect's responses are spoken aloud with a synthesized voice. We pick
 * a Spanish voice if available (the game is in Spanish), and tune the pitch/
 * rate to sound "robotic pixel" — slightly low pitch, slightly fast rate,
 * monotone.
 *
 * Browser support: Web Speech API is available in all modern browsers.
 * On mobile Safari the voice selection is limited; we fall back to the
 * default voice.
 *
 * Usage:
 *   speak("No recuerdo nada de esa noche.");
 *   stopSpeaking();  // interrupt (e.g., when a new question is sent)
 *
 * Respect the same mute flag as the sound engine — if muted, no TTS.
 */

import { isMuted } from "./sound-engine";

let _voice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;

function loadVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;
  _voicesLoaded = true;

  // Prefer a Spanish voice — try es-ES, es-MX, es-US, es-*, in that order.
  const spanishVoice =
    voices.find((v) => v.lang === "es-ES" && /female|mujer|maría|paulina/i.test(v.name)) ||
    voices.find((v) => v.lang === "es-ES") ||
    voices.find((v) => v.lang === "es-MX") ||
    voices.find((v) => v.lang === "es-US") ||
    voices.find((v) => v.lang?.startsWith("es")) ||
    null;

  _voice = spanishVoice;
}

// Initialize voices (they load asynchronously in some browsers).
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export function isTTSAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Speak the given text. If already speaking, the previous utterance is
 * cancelled (so a new question's response isn't queued behind the old one).
 *
 * The voice is tuned to sound "robotic pixel": slightly low pitch (0.85),
 * slightly fast rate (1.05), no natural inflection.
 */
export function speak(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (isMuted()) return;
  if (!text?.trim()) return;

  // Cancel any in-progress speech.
  window.speechSynthesis.cancel();

  if (!_voicesLoaded) loadVoices();

  // Strip the typewriter cursor and any leading/trailing whitespace.
  const clean = text.replace(/[▮█]/g, "").trim();
  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean);

  if (_voice) {
    utterance.voice = _voice;
    utterance.lang = _voice.lang;
  } else {
    utterance.lang = "es-ES";
  }

  // Robotic pixel voice: low pitch, slightly fast, monotone.
  utterance.pitch = 0.8;
  utterance.rate = 1.05;
  utterance.volume = 0.9;

  // Remove emoji and bracketed metadata — they sound weird when read aloud.
  utterance.text = clean
    .replace(/\[.*?\]/g, "") // [Detective X pregunta]
    .replace(/[👤🔵🔷🔺🟡🟢🔴⚠✓▸▶]/g, "")
    .replace(/\*pensamiento\*/gi, "")
    .replace(/\*+/g, "")
    .trim();

  if (utterance.text) {
    window.speechSynthesis.speak(utterance);
  }
}

/** Stop any in-progress speech. */
export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}
