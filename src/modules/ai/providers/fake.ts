import type { AiProvider, AiRequest, AiResult } from "../provider";

/* ------------------------------------------------------------------ */
/* Provider fake deterministik (Tahap 9B).                             */
/* Tanpa jaringan. Dipakai saat ai_settings.provider = "fake" (mode    */
/* offline/health-check) dan sebagai dasar pola provider lain. Tes     */
/* end-to-end menginjeksi AiProvider sendiri lewat interface, bukan ini. */
/* Tidak melakukan klasifikasi nyata: mengembalikan JSON/teks template  */
/* agar hilir (validasi intent) tetap bisa diuji end-to-end.           */
/* ------------------------------------------------------------------ */

const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

function cannedText(request: AiRequest): string {
  if (request.json) {
    // reportKey "unknown" sengaja invalid -> pemanggil memakainya untuk menguji jalur validasi.
    return JSON.stringify({
      reportKey: "unknown",
      query: {},
      rationale: "provider fake: tidak melakukan klasifikasi nyata",
    });
  }
  return "(ringkasan placeholder provider fake — angka berasal dari service deterministik, AI tidak menghitung)";
}

export const fakeProvider: AiProvider = {
  name: "fake",
  async generate(request: AiRequest): Promise<AiResult> {
    const text = cannedText(request);
    return {
      text,
      inputTokens: estimateTokens(`${request.system ?? ""}${request.prompt}`),
      outputTokens: estimateTokens(text),
      model: "fake-model",
    };
  },
};
