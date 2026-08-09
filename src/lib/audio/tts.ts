/**
 * Text-to-Speech wrapper -- Web Speech API.
 *
 * Configured to approximate a Loquendo-style voice:
 * - Deep pitch (0.7 for men, 0.95 for women)
 * - Slightly fast rate (1.1) for that classic brisk delivery
 * - Uses the best available Spanish male voice
 *
 * NOTE: True "Jorge Loquendo" is a proprietary TTS engine not available
 * in browsers. This uses the best approximation possible with Web Speech API.
 * For actual Loquendo quality, an external TTS service (ElevenLabs, Google Cloud)
 * would be needed.
 */

import { isVoiceMuted } from "./sound-engine";
import type { Gender } from "@/lib/ai/generated-case";

let _maleVoice: SpeechSynthesisVoice | null = null;
let _femaleVoice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;

// Voice patterns for selection priority
const FEMALE_PATTERNS = /female|mujer|maria|paulina|monica|helena|laura|lucia|sofia|isabel|penelope|elvira|fem/i;
const MALE_PATTERNS = /male|hombre|diego|carlos|juan|miguel|pablo|alejandro|javier|ricardo|masculino|jorge|loquendo/i;

function loadVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;
  _voicesLoaded = true;

  const spanishVoices = voices.filter((v) => v.lang?.startsWith("es"));

  // Prefer any Loquendo/Jorge voice, then male Spanish, then fallback
  _maleVoice =
    spanishVoices.find((v) => MALE_PATTERNS.test(v.name)) ||
    spanishVoices.find((v) => !FEMALE_PATTERNS.test(v.name)) ||
    spanishVoices[0] ||
    null;

  _femaleVoice =
    spanishVoices.find((v) => FEMALE_PATTERNS.test(v.name)) ||
    spanishVoices.find((v) => !MALE_PATTERNS.test(v.name)) ||
    spanishVoices[0] ||
    null;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export function isTTSAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Speak the given text. Configured for a Loquendo-like style:
 * - Deep male voice (pitch 0.7) or female (pitch 0.95)
 * - Slightly fast rate (1.1) -- Loquendo was known for clear, brisk speech
 */
export function speak(text: string, gender: Gender = "man"): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (isVoiceMuted()) return;
  if (!text?.trim()) return;

  // Cancel any previous speech to prevent double-play
  window.speechSynthesis.cancel();
  if (!_voicesLoaded) loadVoices();

  const clean = text.replace(/[\u25ae\u2588]/g, "").trim();
  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean);

  const voice = gender === "woman" ? _femaleVoice : _maleVoice;
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "es-ES";
  }

  // Loquendo approximation: deep, brisk, clear
  utterance.pitch = gender === "woman" ? 0.95 : 0.7;
  utterance.rate = 1.1;
  utterance.volume = 0.95;

  // Clean text for speech
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
