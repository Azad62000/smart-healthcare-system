"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { EmptyCard, ErrorNotice, LoadingCard } from "../components/doctor-ui";
import { DashboardBackLink } from "../components/dashboard-back-link";
import { DoctorRating } from "../components/doctor-rating";
import { doctorInitials, doctorPortrait } from "./portraits";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type DirectoryDoctor = { id: string; givenName: string; familyName: string; specialization: string; qualification: string | null; experienceYears: number | null; bio: string | null; city?: string | null; state?: string | null; isSynthetic?: boolean; ratingAverage?: number | null; ratingCount?: number; availability: Array<{ id: string; startsAt: string; endsAt: string }> };

export default function DoctorDirectoryPage() {
  const [doctors, setDoctors] = useState<DirectoryDoctor[]>([]);
  const [specialization, setSpecialization] = useState("");
  const [search, setSearch] = useState("");
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
  const visibleDoctors = doctors.filter((doctor) => `${doctor.givenName} ${doctor.familyName} ${doctor.specialization} ${doctor.city ?? ""} ${doctor.state ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  const publishedPeriods = doctors.reduce((total, doctor) => total + doctor.availability.length, 0);
  return <main className="patient-dashboard">
    <DashboardBackLink />
    <header className="directory-hero"><div><p className="eyebrow">FIND THE RIGHT CARE</p><h1>Meet your care team</h1><p>Explore approved doctors and choose a visit that fits your needs.</p><div className="directory-hero-stats"><span><strong>{loading ? "—" : doctors.length}</strong> doctors in this list</span><span><strong>{loading ? "—" : publishedPeriods}</strong> published availability periods</span></div></div><div className="directory-art" aria-hidden="true"><span className="directory-art-ring"/><span className="directory-art-symbol"><svg viewBox="0 0 64 64" focusable="false"><path d="M5 34h13l7-14 11 29 8-20 6 9h9" /></svg></span><span className="directory-art-dot"/></div></header>
    <section className="directory-search-panel"><form className="directory-filter" onSubmit={submit}><label>Specialization<input value={specialization} onChange={(event) => setSpecialization(event.target.value)} placeholder="e.g. Cardiology" maxLength={100} /></label><button className="primary-button" type="submit">Apply filter</button><button className="secondary-button" type="button" onClick={() => { setSpecialization(""); setSearch(""); void load(); }}>Clear</button></form><label className="directory-search"><span aria-hidden="true">⌕</span><span className="sr-only">Search doctors by name, specialty, or location</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by doctor, specialty, or location" /></label></section>
    {error && <ErrorNotice message={error} onRetry={() => void load(specialization)} />}
    {loading ? <LoadingCard>Loading approved doctors…</LoadingCard> : visibleDoctors.length === 0 ? <section className="dashboard-card"><EmptyCard title={doctors.length ? "No doctors match your search" : "No approved doctors found"}>{doctors.length ? "Try a different name, specialty, or location." : "Try another specialization or check again later."}</EmptyCard></section> : <><p className="directory-result-count" role="status">Showing <strong>{visibleDoctors.length}</strong> of {doctors.length} doctors</p><div className="directory-grid">{visibleDoctors.map((doctor) => {
      const portrait = doctorPortrait(doctor.givenName, doctor.familyName, doctor.isSynthetic);
      return <article className="dashboard-card directory-doctor" key={doctor.id}>
        <figure className="doctor-portrait-frame">{portrait ? <img className="doctor-portrait" src={portrait} alt={`Illustration of fictional clinician Dr. ${doctor.givenName} ${doctor.familyName}`} width="112" height="112" loading="lazy" /> : <div className="doctor-portrait doctor-placeholder" role="img" aria-label={`No profile photo provided for Dr. ${doctor.givenName} ${doctor.familyName}`}>{doctorInitials(doctor.givenName, doctor.familyName)}</div>}<figcaption>{portrait ? "Illustration · fictional clinician" : "Profile photo not provided"}</figcaption></figure>
        <p className="eyebrow">{doctor.specialization}</p><h2>Dr. {doctor.givenName} {doctor.familyName}</h2>
        {doctor.isSynthetic && <em className="synthetic-label">Fictional clinician · not for real care</em>}
        <DoctorRating average={doctor.ratingAverage} count={doctor.ratingCount} />
        {doctor.city && <p className="doctor-qualification">{doctor.city}{doctor.state ? `, ${doctor.state}` : ""}</p>}
        {!doctor.isSynthetic && doctor.qualification && <p className="doctor-qualification">{doctor.qualification}</p>}
        {!doctor.isSynthetic && doctor.experienceYears !== null && <p className="doctor-qualification">{doctor.experienceYears} years of experience</p>}
        {doctor.bio && <p className="doctor-bio">{doctor.bio}</p>}
        <p className="availability-summary"><span aria-hidden="true">◷</span> {doctor.availability.length ? `${doctor.availability.length} upcoming availability period${doctor.availability.length === 1 ? "" : "s"}` : "Availability not published"}</p>
        <div className="doctor-card-actions"><a className="secondary-button" href={`/doctors/${doctor.id}`}>View profile</a><a className="primary-button" href="/patient/appointments#booking">Book a visit <span aria-hidden="true">→</span></a></div>
      </article>;
    })}</div></>}
  </main>;
}
