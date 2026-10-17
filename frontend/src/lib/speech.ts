export type SpeechStatus =
  | "idle"
  | "unsupported"
  | "requesting"
  | "listening"
  | "stopping"
  | "final"
  | "error"
  | "permission-denied"
  | "no-speech"
  | "network"
  | "muted"
  | "paused"
  | "sending";

export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}

export type SpeechResultListLike = ArrayLike<SpeechResultLike>;

/**
 * Collect each final result once per recognition run. Result index is part of
 * the identity so two different utterances that happen to have the same words
 * are both retained.
 */
export function collectFinalSpeechResults(
  runId: string,
  results: SpeechResultListLike,
  seen: Set<string>
): string[] {
  const finals: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result?.isFinal) continue;
    const key = `${runId}:${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const transcript = result[0]?.transcript.trim();
    if (transcript) finals.push(transcript);
  }
  return finals;
}

export function getSpeechErrorStatus(error: string): SpeechStatus {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    default:
      return "error";
  }
}

export function getSpeechStatusMessage(status: SpeechStatus): string {
  switch (status) {
    case "unsupported":
      return "Este navegador não oferece transcrição de voz. Você ainda pode digitar sua mensagem.";
    case "requesting":
      return "Solicitando acesso ao microfone…";
    case "listening":
      return "Ouvindo em português do Brasil. A mensagem será enviada após uma pausa na fala.";
    case "stopping":
      return "Finalizando a transcrição…";
    case "final":
      return "Fala reconhecida.";
    case "permission-denied":
      return "A permissão do microfone foi negada. Autorize o microfone nas configurações do navegador ou digite sua mensagem.";
    case "no-speech":
      return "Nenhuma fala foi reconhecida. Tente novamente ou digite sua mensagem.";
    case "network":
      return "O serviço de reconhecimento de voz está indisponível pela rede. Tente novamente ou digite sua mensagem.";
    case "muted":
      return "Microfone mutado. Ative para falar e enviar mensagens por voz.";
    case "paused":
      return "Transcrição pausada enquanto a mensagem é confirmada.";
    case "sending":
      return "Enviando mensagem de voz…";
    case "error":
      return "A transcrição de voz encontrou um erro. Tente novamente ou digite sua mensagem.";
    case "idle":
      return "";
  }
}
