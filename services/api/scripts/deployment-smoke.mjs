import { randomUUID } from "node:crypto";

const apiUrl = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
const webUrl = process.env.WEB_PUBLIC_URL?.replace(/\/+$/, "");
const webOrigin = process.env.WEB_ORIGIN ?? (webUrl ? new URL(webUrl).origin : undefined);

if (!apiUrl || !webUrl || !webOrigin) {
  throw new Error("Set API_PUBLIC_URL and WEB_PUBLIC_URL before running the deployment smoke check.");
}

async function expectResponse(name, url, options, expectedStatus = 200) {
  const response = await fetch(url, options);
  if (response.status !== expectedStatus) throw new Error(`${name} returned HTTP ${response.status}; expected ${expectedStatus}.`);
  return response;
}

const apiRoot = await expectResponse("API root", `${apiUrl}/`);
if ((await apiRoot.json()).data?.service !== "healthcare-api") throw new Error("API root returned an unexpected service response.");
const health = await expectResponse("API liveness", `${apiUrl}/health`);
if ((await health.json()).data?.status !== "ok") throw new Error("API liveness response was not healthy.");
const readiness = await expectResponse("API database readiness", `${apiUrl}/health/ready`);
if ((await readiness.json()).data?.database !== "ok") throw new Error("API database readiness check did not report a ready database.");
const directory = await expectResponse("Database-backed doctor directory", `${apiUrl}/api/v1/doctors/directory`);
if (!Array.isArray((await directory.json()).data?.doctors)) throw new Error("Doctor directory did not return a list.");
await expectResponse("Web home page", `${webUrl}/`);
await expectResponse("Web sign-in page", `${webUrl}/signin`);

const preflight = await expectResponse("Credentialed API CORS preflight", `${apiUrl}/api/v1/auth/login`, {
  method: "OPTIONS",
  headers: {
    Origin: webOrigin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type"
  }
}, 204);
if (preflight.headers.get("access-control-allow-origin") !== webOrigin || preflight.headers.get("access-control-allow-credentials") !== "true") {
  throw new Error("API CORS does not allow the configured web origin with credentials.");
}

const patientEmail = process.env.SMOKE_PATIENT_EMAIL;
const patientPassword = process.env.SMOKE_PATIENT_PASSWORD;
const appointmentId = process.env.SMOKE_APPOINTMENT_ID;
const integrationRequested = Boolean(patientEmail || patientPassword || appointmentId);
if (integrationRequested) {
  if (process.env.SMOKE_DATA_IS_SYNTHETIC !== "true" || !patientEmail || !patientPassword) {
    throw new Error("Authenticated checks require a synthetic test Patient account and SMOKE_DATA_IS_SYNTHETIC=true.");
  }
  const login = await expectResponse("Synthetic Patient login", `${apiUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: webOrigin },
    body: JSON.stringify({ email: patientEmail, password: patientPassword })
  });
  const setCookies = login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""];
  const sessionCookie = setCookies.map((value) => value.split(";")[0]).find((value) => value.startsWith("healthcare_session="));
  if (!sessionCookie) throw new Error("Synthetic Patient login did not return a session cookie.");
  const session = await expectResponse("Authenticated session lookup", `${apiUrl}/api/v1/auth/me`, { headers: { Cookie: sessionCookie, Origin: webOrigin } });
  if ((await session.json()).data?.user?.role !== "Patient") throw new Error("Synthetic account did not authenticate as a Patient.");

  if (appointmentId) {
    const base = `${apiUrl}/api/v1/appointments/${appointmentId}/documents`;
    await expectResponse("Authorized appointment document list", base, { headers: { Cookie: sessionCookie, Origin: webOrigin } });
    const pdf = Buffer.from("%PDF-1.4\nSynthetic deployment storage check.\n%%EOF\n");
    const upload = await expectResponse("Encrypted appointment document upload", base, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: webOrigin,
        "Content-Type": "application/pdf",
        "x-file-name": encodeURIComponent(`synthetic-smoke-${randomUUID()}.pdf`)
      },
      body: pdf
    }, 201);
    const documentId = (await upload.json()).data?.document?.id;
    if (!documentId) throw new Error("Document upload did not return a document ID.");
    const download = await expectResponse("Authorized appointment document download", `${base}/${documentId}`, { headers: { Cookie: sessionCookie, Origin: webOrigin } });
    const downloadedPdf = Buffer.from(await download.arrayBuffer());
    if (!downloadedPdf.equals(pdf)) throw new Error("Downloaded document did not match the synthetic upload.");
    await expectResponse("Appointment document cleanup", `${base}/${documentId}`, {
      method: "DELETE",
      headers: { Cookie: sessionCookie, Origin: webOrigin }
    });
    console.log("Passed authenticated session and encrypted object-storage round trip using synthetic data.");
  }
}

console.log("Passed API, database readiness, doctor directory, frontend, and credentialed CORS checks.");
