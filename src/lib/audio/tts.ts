/**
 * Text-to-Speech wrapper -- Web Speech API.
 *
 * Configured to use the closest voice to "Jorge Loquendo" -- the classic
 * Spanish male TTS voice.  We prefer voices whose name contains "jorge",
 * "loquendo", "pablo", "diego" or any male Spanish voice.  Fallback is
 * the default es-ES voice.
 *
 * Gender-aware voice selection:
 *   - "man"   -> prefer male Spanish voices (Jorge Loquendo style)
 *   - "woman" -> prefer female Spanish voices
 *
 * The voice is tuned to sound robotic pixel: slightly low pitch, slightly
 * fast rate, monotone.
 *
 * Usage:
 *   speak("No recuerdo nada de esa noche.", "woman");
 *   stopSpeaking();  // interrupt (e.g., when a new question is sent)
 *
 * Respect the same mute flag as the sound engine -- if muted, no TTS.
 */

import { isMuted } from "./sound-engine";
import type { Gender } from "@/lib/ai/generated-case";

let _maleVoice: SpeechSynthesisVoice | null = null;
let _femaleVoice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;

// Heuristics for detecting male/female voices from voice names.
// Jorge Loquendo priority patterns first, then generic patterns.
const LOQUENDO_PATTERNS = /jorge|loquendo/i;
const FEMALE_PATTERNS = /female|mujer|maria|paulina|monica|helena|laura|lucia|sofia|isabel|penelope|elvira|fem/i;
const MALE_PATTERNS = /male|hombre|diego|carlos|juan|miguel|pablo|alejandro|javier|ricardo|masculino/i;

function loadVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;
  _voicesLoaded = true;

  const spanishVoices = voices.filter((v) => v.lang?.startsWith("es"));

  // Pick the best male Spanish voice -- prioritize Jorge Loquendo-like names.
  _maleVoice =
    spanishVoices.find((v) => LOQUENDO_PATTERNS.test(v.name)) ||
    spanishVoices.find((v) => MALE_PATTERNS.test(v.name)) ||
    // If no explicitly male voice, pick one that's NOT explicitly female
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
 * @param gender "man" | "woman" -- selects male or female voice.
 *
 * Tuned to sound like Jorge Loquendo: slightly low pitch (0.8 for men),
 * slightly fast rate (1.08), monotone. Women get a slightly higher pitch
 * so they don't sound artificially deep.
 */
export function speak(text: string, gender: Gender = "man"): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (isMuted()) return;
  if (!text?.trim()) return;

  // Cancel any in-progress speech.
  window.speechSynthesis.cancel();

  if (!_voicesLoaded) loadVoices();

  // Strip the typewriter cursor and any leading/trailing whitespace.
  const clean = text.replace(/[\u25ae\u2588]/g, "").trim();
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

  // Jorge Loquendo style voice -- deep, slightly fast, clear articulation.
  utterance.pitch = gender === "woman" ? 1.0 : 0.8;
  utterance.rate = 1.08;
  utterance.volume = 0.9;

  // Remove bracketed metadata -- they sound weird when read aloud.
  utterance.text = clean
    .replace(/\[.*?\]/g, "")
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
