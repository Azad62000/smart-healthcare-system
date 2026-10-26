"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyCard, ErrorNotice, LoadingCard } from "../../components/doctor-ui";
import { DashboardBackLink } from "../../components/dashboard-back-link";
import { DoctorRating } from "../../components/doctor-rating";
import { doctorInitials, doctorPortrait } from "../portraits";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Doctor = { id: string; givenName: string; familyName: string; specialization: string; qualification: string | null; experienceYears: number | null; bio: string | null; isSynthetic?: boolean; city?: string | null; state?: string | null; country?: string | null; consultationModes?: Array<"video" | "in_person">; consultationFeeInr?: number | null; ratingAverage?: number | null; ratingCount?: number; availability: Array<{ id: string; startsAt: string; endsAt: string }> };

export default function DoctorProfilePage() {
  const params = useParams<{ id: string }>();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${apiUrl}/api/v1/doctors/directory/${encodeURIComponent(params.id)}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Doctor profile is unavailable."); setDoctor(body.data.doctor); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Doctor profile is unavailable."))
      .finally(() => setLoading(false));
  }, [params.id]);
  const portrait = doctor ? doctorPortrait(doctor.givenName, doctor.familyName, doctor.isSynthetic) : null;
  return <main className="patient-dashboard"><DashboardBackLink /><a className="back-link" href="/doctors">← Doctor directory</a>{error && <ErrorNotice message={error} />}{loading ? <LoadingCard>Loading doctor profile…</LoadingCard> : doctor ? <article className="dashboard-card doctor-public-profile">
    <div className="doctor-profile-heading">
      <figure className="doctor-portrait-frame doctor-portrait-large">{portrait ? <img className="doctor-portrait" src={portrait} alt={`Illustration of fictional clinician Dr. ${doctor.givenName} ${doctor.familyName}`} width="176" height="176" /> : <div className="doctor-portrait doctor-placeholder" role="img" aria-label={`No profile photo provided for Dr. ${doctor.givenName} ${doctor.familyName}`}>{doctorInitials(doctor.givenName, doctor.familyName)}</div>}<figcaption>{portrait ? "Illustration · fictional clinician" : "Profile photo not provided"}</figcaption></figure>
      <div><p className="eyebrow">{doctor.specialization}</p><h1>Dr. {doctor.givenName} {doctor.familyName}</h1>{doctor.isSynthetic && <p className="synthetic-label">Fictional clinician · not for real care</p>}
        <DoctorRating average={doctor.ratingAverage} count={doctor.ratingCount} />
        {doctor.city && <p>{doctor.city}{doctor.state ? `, ${doctor.state}` : ""}{doctor.country ? `, ${doctor.country}` : ""}</p>}
        {!doctor.isSynthetic && doctor.qualification && <p>{doctor.qualification}</p>}{!doctor.isSynthetic && doctor.experienceYears !== null && <p>{doctor.experienceYears} years of experience</p>}
        {doctor.consultationModes && <p>Consultation modes: {doctor.consultationModes.map((mode) => mode === "video" ? "Video" : "In person").join(", ")}</p>}
        {doctor.isSynthetic && doctor.consultationFeeInr !== null && doctor.consultationFeeInr !== undefined && <p>Illustrative fee: INR {doctor.consultationFeeInr}</p>}
      </div>
    </div>
    {doctor.bio && <p className="doctor-bio">{doctor.bio}</p>}
    <section><h2>Published availability</h2>{doctor.availability.length ? <ul className="availability-list">{doctor.availability.map((slot) => <li key={slot.id}>{new Date(slot.startsAt).toLocaleString()} – {new Date(slot.endsAt).toLocaleTimeString()}</li>)}</ul> : <EmptyCard title="No availability published">Availability will appear here when published by the doctor.</EmptyCard>}</section>
    <p className="form-help">Appointments can be booked from the <a href="/patient/appointments">Patient appointments page</a> after signing in.</p>
  </article> : null}</main>;
}
