"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { EmptyCard, ErrorNotice, LoadingCard } from "../components/doctor-ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type DirectoryDoctor = { id: string; givenName: string; familyName: string; specialization: string; qualification: string | null; experienceYears: number | null; bio: string | null; city?: string | null; state?: string | null; isSynthetic?: boolean; availability: Array<{ id: string; startsAt: string; endsAt: string }> };

export default function DoctorDirectoryPage() {
  const [doctors, setDoctors] = useState<DirectoryDoctor[]>([]);
  const [specialization, setSpecialization] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (filter = "") => {
    setLoading(true); setError("");
    try {
      const query = filter.trim() ? `?specialization=${encodeURIComponent(filter.trim())}` : "";
      const response = await fetch(`${apiUrl}/api/v1/doctors/directory${query}`);
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message ?? "Directory is unavailable."); }
      const body = await response.json(); setDoctors(body.data.doctors);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Directory is unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function submit(event: FormEvent) { event.preventDefault(); void load(specialization); }

  return <main className="patient-dashboard">
    <header className="dashboard-heading"><div><p className="eyebrow">FIND CARE</p><h1>Doctor directory</h1><p>Browse approved doctors and their published availability.</p></div></header>
    <form className="directory-filter" onSubmit={submit}><label>Specialization<input value={specialization} onChange={(event) => setSpecialization(event.target.value)} placeholder="e.g. Cardiology" maxLength={100} /></label><button className="primary-button" type="submit">Apply filter</button><button className="secondary-button" type="button" onClick={() => { setSpecialization(""); void load(); }}>Clear</button></form>
    {error && <ErrorNotice message={error} onRetry={() => void load(specialization)} />}
    {loading ? <LoadingCard>Loading approved doctors…</LoadingCard> : doctors.length === 0 ? <section className="dashboard-card"><EmptyCard title="No approved doctors found">Try another specialization or check again later.</EmptyCard></section> : <div className="directory-grid">{doctors.map((doctor) => <article className="dashboard-card directory-doctor" key={doctor.id}><p className="eyebrow">{doctor.specialization}</p><h2>Dr. {doctor.givenName} {doctor.familyName}</h2>{doctor.isSynthetic && <em className="synthetic-label">Synthetic demo profile · not a verified healthcare provider</em>}{doctor.city && <p className="doctor-qualification">{doctor.city}{doctor.state ? `, ${doctor.state}` : ""}</p>}{!doctor.isSynthetic && doctor.qualification && <p className="doctor-qualification">{doctor.qualification}</p>}{!doctor.isSynthetic && doctor.experienceYears !== null && <p className="doctor-qualification">{doctor.experienceYears} years of experience</p>}{doctor.bio && <p className="doctor-bio">{doctor.bio}</p>}<p className="availability-summary">{doctor.availability.length ? `${doctor.availability.length} upcoming availability period${doctor.availability.length === 1 ? "" : "s"}` : "Availability not published"}</p><a className="card-link" href={`/doctors/${doctor.id}`}>View profile <span aria-hidden="true">→</span></a></article>)}</div>}
  </main>;
}
