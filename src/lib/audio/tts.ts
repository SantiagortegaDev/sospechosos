/**
 * Text-to-Speech wrapper -- Web Speech API + AudioContext filter.
 *
 * Configured to sound like Jorge Loquendo -- the classic Spanish male
 * TTS voice. Uses the best available male Spanish voice and applies
 * an AudioContext low-pass filter to give it that characteristic
 * warm, slightly muffled Loquendo sound.
 *
 * The audio filter only works when there's an active AudioContext.
 * Falls back to plain SpeechSynthesis on mobile/safari.
 */

import { isMuted } from "./sound-engine";
import type { Gender } from "@/lib/ai/generated-case";

let _maleVoice: SpeechSynthesisVoice | null = null;
let _femaleVoice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;
let _audioCtx: AudioContext | null = null;
let _filterNode: BiquadFilterNode | null = null;
let _mediaStreamDest: MediaStreamAudioDestinationNode | null = null;

// Loquendo voice patterns
const LOQUENDO_PATTERNS = /jorge|loquendo/i;
const FEMALE_PATTERNS = /female|mujer|maria|paulina|monica|helena|laura|lucia|sofia|isabel|penelope|elvira|fem/i;
const MALE_PATTERNS = /male|hombre|diego|carlos|juan|miguel|pablo|alejandro|javier|ricardo|masculino/i;

/** Initialize the AudioContext + low-pass filter for Loquendo warmth */
function ensureAudioContext(): boolean {
  if (typeof window === "undefined" || !("AudioContext" in window)) return false;
  try {
    if (!_audioCtx) {
      _audioCtx = new AudioContext();
      _filterNode = _audioCtx.createBiquadFilter();
      _filterNode.type = "lowpass";
      _filterNode.frequency.value = 3200;   // Loquendo warmth cutoff
      _filterNode.Q.value = 0.7;              // Gentle resonance
      _mediaStreamDest = _audioCtx.createMediaStreamDestination();
      _filterNode.connect(_mediaStreamDest);
      _filterNode.connect(_audioCtx.destination);
    }
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    return true;
  } catch {
    return false;
  }
}

function loadVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;
  _voicesLoaded = true;

  const spanishVoices = voices.filter((v) => v.lang?.startsWith("es"));

  // Jorge Loquendo priority: any voice with "jorge" or "loquendo" in name
  _maleVoice =
    spanishVoices.find((v) => LOQUENDO_PATTERNS.test(v.name)) ||
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
 * Speak the given text. Configured for Jorge Loquendo style:
 * - Deep male voice (pitch 0.75) or female (pitch 1.0)
 * - Slightly fast rate (1.1) -- Loquendo was known for clear, brisk speech
 * - AudioContext low-pass filter for warmth
 */
export function speak(text: string, gender: Gender = "man"): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (isMuted()) return;
  if (!text?.trim()) return;

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

  // Jorge Loquendo signature: deep, brisk, clear
  utterance.pitch = gender === "woman" ? 1.0 : 0.75;
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
