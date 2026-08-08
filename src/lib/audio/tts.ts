/**
 * Text-to-Speech wrapper — Web Speech API.
 *
 * The suspect's responses are spoken aloud with a synthesized voice. We pick
 * a Spanish voice if available (the game is in Spanish), and tune the pitch/
 * rate to sound "robotic pixel" — slightly low pitch, slightly fast rate,
 * monotone.
 *
 * Gender-aware voice selection:
 *   - "man"   → prefer male Spanish voices
 *   - "woman" → prefer female Spanish voices
 *   The suspect's gender comes from the case generator.
 *
 * Browser support: Web Speech API is available in all modern browsers.
 * On mobile Safari the voice selection is limited; we fall back to the
 * default voice.
 *
 * Usage:
 *   speak("No recuerdo nada de esa noche.", "woman");
 *   stopSpeaking();  // interrupt (e.g., when a new question is sent)
 *
 * Respect the same mute flag as the sound engine — if muted, no TTS.
 */

import { isMuted } from "./sound-engine";
import type { Gender } from "@/lib/ai/generated-case";

let _maleVoice: SpeechSynthesisVoice | null = null;
let _femaleVoice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;

// Heuristics for detecting male/female voices from voice names.
// Browser voice names are inconsistent; these patterns cover the common
// Spanish voices across Chrome, Firefox, Edge, and Safari.
const FEMALE_PATTERNS = /female|mujer|maría|paulina|monica|helena|laura|lucia|sofia|isabel|penelope|elvira|fem/i;
const MALE_PATTERNS = /male|hombre|jorge|diego|carlos|juan|miguel|pablo|alejandro|male|javier|ricardo|masculino/i;

function loadVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;
  _voicesLoaded = true;

  const spanishVoices = voices.filter((v) => v.lang?.startsWith("es"));

  // Pick the best male Spanish voice.
  _maleVoice =
    spanishVoices.find((v) => MALE_PATTERNS.test(v.name)) ||
    // If no explicitly male voice, pick one that's NOT explicitly female
    // (often the "default" es-ES voice is male-ish on some platforms).
    spanishVoices.find((v) => !FEMALE_PATTERNS.test(v.name)) ||
    spanishVoices[0] ||
    null;

  // Pick the best female Spanish voice.
  _femaleVoice =
    spanishVoices.find((v) => FEMALE_PATTERNS.test(v.name)) ||
    spanishVoices.find((v) => !MALE_PATTERNS.test(v.name)) ||
    spanishVoices[0] ||
    null;
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
 * @param text   The text to speak.
 * @param gender "man" | "woman" — selects male or female voice.
 *
 * The voice is tuned to sound "robotic pixel": slightly low pitch (0.85
 * for men, 0.95 for women — women get a slightly higher pitch so they
 * don't sound artificially deep), slightly fast rate (1.05), monotone.
 */
export function speak(text: string, gender: Gender = "man"): void {
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

  // Pick voice by gender.
  const voice = gender === "woman" ? _femaleVoice : _maleVoice;
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "es-ES";
  }

  // Robotic pixel voice — pitch varies by gender so men sound male
  // and women sound female, even on browsers with limited voice options.
  utterance.pitch = gender === "woman" ? 0.95 : 0.75;
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
