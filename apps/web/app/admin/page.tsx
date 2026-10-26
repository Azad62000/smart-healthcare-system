"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { DashboardNav } from "../components/dashboard-nav";
import { apiData } from "../lib/api";

type Overview = {
  patientCount: number;
  approvedDoctorCount: number;
  appointmentCount: number;
  appointmentsByStatus: Array<{ status: string; count: number }>;
  pendingAppointmentCount: number;
  upcomingAppointmentCount: number;
  generatedAt: string;
};
type PendingDoctor = {
  id: string;
  givenName: string;
  familyName: string;
  specialization: string;
  qualification: string | null;
  experienceYears: number | null;
  bio: string | null;
  approvalStatus: "pending";
};
type ManagedUser = { id: string; email: string; role: "Patient" | "Doctor" | "Admin"; status: "active" | "inactive" | "locked"; createdAt: string };
type ServiceHealth = { name: string; status: "healthy" | "unavailable" | "not_configured"; checkedAt: string; responseTimeMs: number | null; detail: string };
type SchedulingOption = { id: string; name: string; email: string };
type AdminAppointment = {
  id: string; patientDisplayName: string; patientEmail: string; doctorDisplayName: string; doctorEmail: string;
  startsAt: string; endsAt: string; status: string; type: "in_person" | "video";
  schedulingNote: string | null; adminNote: string | null;
};

export default function AdminDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDoctors, setPendingDoctors] = useState<PendingDoctor[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [decisionNotice, setDecisionNotice] = useState("");
  const [decisionInProgress, setDecisionInProgress] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userStatus, setUserStatus] = useState("");
  const [userStatusBusy, setUserStatusBusy] = useState("");
  const [userNotice, setUserNotice] = useState("");
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");
  const [scheduleOptions, setScheduleOptions] = useState<{ patients: SchedulingOption[]; doctors: SchedulingOption[] }>({ patients: [], doctors: [] });
  const [adminAppointments, setAdminAppointments] = useState<AdminAppointment[]>([]);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [reschedulingId, setReschedulingId] = useState("");
  const [rescheduleTimes, setRescheduleTimes] = useState({ startsAt: "", endsAt: "" });

  const loadOverview = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await apiData<{ overview: Overview }>("/api/v1/analytics/overview");
      setOverview(data.overview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Analytics could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  const loadPendingDoctors = useCallback(async () => {
    setPendingLoading(true); setPendingError("");
    try {
      const data = await apiData<{ doctors: PendingDoctor[] }>("/api/v1/doctors/pending");
      setPendingDoctors(data.doctors);
    } catch (cause) { setPendingError(cause instanceof Error ? cause.message : "Pending doctor applications could not be loaded."); }
    finally { setPendingLoading(false); }
  }, []);

  const loadUsers = useCallback(async (search: string, role: string, status: string) => {
    setUsersLoading(true); setUsersError("");
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set("search", search.trim());
      if (role) query.set("role", role);
      if (status) query.set("status", status);
      const data = await apiData<{ users: ManagedUser[] }>(`/api/v1/admin/users${query.size ? `?${query}` : ""}`);
      setUsers(data.users);
    } catch (cause) { setUsersError(cause instanceof Error ? cause.message : "Users could not be loaded."); }
    finally { setUsersLoading(false); }
  }, []);

  const loadServices = useCallback(async () => {
    setServicesLoading(true); setServicesError("");
    try {
      const data = await apiData<{ services: ServiceHealth[] }>("/api/v1/admin/services");
      setServices(data.services);
    } catch (cause) { setServicesError(cause instanceof Error ? cause.message : "Service status could not be loaded."); }
    finally { setServicesLoading(false); }
  }, []);
  const loadAppointments = useCallback(async () => {
    setScheduleError("");
    try {
      const [optionsResponse, appointmentsResponse] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/admin/appointments/options`, { credentials: "include" }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/admin/appointments`, { credentials: "include" })
      ]);
      const [optionsBody, appointmentsBody] = await Promise.all([optionsResponse.json(), appointmentsResponse.json()]);
      if (!optionsResponse.ok) throw new Error(optionsBody.error?.message ?? "Scheduling options could not be loaded.");
      if (!appointmentsResponse.ok) throw new Error(appointmentsBody.error?.message ?? "Appointments could not be loaded.");
      setScheduleOptions(optionsBody.data);
      setAdminAppointments(appointmentsBody.data.appointments);
    } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Appointments could not be loaded."); }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadPendingDoctors(); }, [loadPendingDoctors]);
  useEffect(() => { void loadUsers("", "", ""); }, [loadUsers]);
  useEffect(() => { void loadServices(); }, [loadServices]);
  useEffect(() => { void loadAppointments(); }, [loadAppointments]);

  async function scheduleAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScheduleBusy(true); setScheduleError(""); setScheduleNotice("");
    const form = new FormData(event.currentTarget);
    const start = new Date(String(form.get("startsAt")));
    const end = new Date(String(form.get("endsAt")));
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/admin/appointments`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: form.get("patientId"),
          doctorId: form.get("doctorId"),
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          type: form.get("type"),
          schedulingNote: form.get("schedulingNote") || null,
          adminNote: form.get("adminNote") || null
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Appointment could not be scheduled.");
      setScheduleNotice("Appointment scheduled and both participants notified.");
      event.currentTarget.reset();
      await loadAppointments();
    } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Appointment could not be scheduled."); }
    finally { setScheduleBusy(false); }
  }

  async function cancelAppointment(id: string) {
    setScheduleError(""); setScheduleNotice("");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/admin/appointments/${id}/cancel`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Cancelled by administrator" })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Appointment could not be cancelled.");
      setScheduleNotice("Appointment cancelled and participants notified.");
      await loadAppointments();
    } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Appointment could not be cancelled."); }
  }

  async function rescheduleAppointment(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); setScheduleError(""); setScheduleNotice("");
    const start = new Date(rescheduleTimes.startsAt);
    const end = new Date(rescheduleTimes.endsAt);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/admin/appointments/${id}/reschedule`, {
        method: "PATCH", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ startsAt: start.toISOString(), endsAt: end.toISOString() })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Appointment could not be rescheduled.");
      setScheduleNotice("Appointment rescheduled and participants notified.");
      setReschedulingId("");
      setRescheduleTimes({ startsAt: "", endsAt: "" });
      await loadAppointments();
    } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Appointment could not be rescheduled."); }
  }

  async function decideDoctor(doctor: PendingDoctor, status: "approved" | "rejected" | "suspended") {
    setDecisionInProgress(doctor.id); setDecisionError(""); setDecisionNotice("");
    try {
      await apiData(`/api/v1/doctors/${doctor.id}/approval`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status })
      });
      setPendingDoctors((current) => current.filter(({ id }) => id !== doctor.id));
      setDecisionNotice(`${doctor.givenName} ${doctor.familyName} was ${status}.`);
    } catch (cause) { setDecisionError(cause instanceof Error ? cause.message : "Doctor approval status could not be updated."); }
    finally { setDecisionInProgress(""); }
  }

  async function updateUserStatus(user: ManagedUser, status: ManagedUser["status"]) {
    setUserStatusBusy(user.id); setUsersError(""); setUserNotice("");
    try {
      const data = await apiData<{ user: ManagedUser }>(`/api/v1/admin/users/${user.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status })
      });
      setUsers((current) => current.map((item) => item.id === user.id ? data.user : item));
      setUserNotice(`Status updated for ${user.email}.`);
    } catch (cause) { setUsersError(cause instanceof Error ? cause.message : "User status could not be updated."); }
    finally { setUserStatusBusy(""); }
  }

  return <main className="patient-dashboard admin-dashboard">
    <DashboardNav currentPath="/admin" links={[{ href: "/admin", label: "Overview" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">ADMIN WORKSPACE</p><h1>Operational overview</h1><p>Aggregate service activity at a glance.</p></div><button className="secondary-button" type="button" onClick={() => void loadOverview()} disabled={loading}>Refresh</button></header>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={() => void loadOverview()}>Retry</button></div>}
    {loading ? <section className="dashboard-card loading-card" role="status"><span className="spinner" />Loading operational overview…</section> : overview && <>
      <section className="analytics-metrics" aria-label="Healthcare service summary">
        <article className="dashboard-card metric-card"><p className="eyebrow">PATIENTS</p><strong>{overview.patientCount}</strong><span>Registered patient profiles</span></article>
        <article className="dashboard-card metric-card"><p className="eyebrow">APPROVED DOCTORS</p><strong>{overview.approvedDoctorCount}</strong><span>Listed for patient booking</span></article>
        <article className="dashboard-card metric-card"><p className="eyebrow">APPOINTMENTS</p><strong>{overview.appointmentCount}</strong><span>All appointment records</span></article>
        <article className="dashboard-card metric-card"><p className="eyebrow">PENDING</p><strong>{overview.pendingAppointmentCount}</strong><span>Future bookings awaiting confirmation</span></article>
        <article className="dashboard-card metric-card"><p className="eyebrow">UPCOMING</p><strong>{overview.upcomingAppointmentCount}</strong><span>Booked or confirmed from now</span></article>
      </section>
      <section className="dashboard-card analytics-status-card"><div className="card-heading"><div><p className="eyebrow">APPOINTMENT ACTIVITY</p><h2 id="appointments-by-status">Appointments by status</h2></div></div>
        {overview.appointmentsByStatus.length === 0 ? <p className="notification-empty">No appointments have been recorded.</p> : <div className="analytics-table-wrap"><table className="analytics-table" aria-labelledby="appointments-by-status"><thead><tr><th scope="col">Status</th><th scope="col">Count</th></tr></thead><tbody>{overview.appointmentsByStatus.map(({ status, count }) => <tr key={status}><th scope="row">{status.replace("_", " ")}</th><td>{count}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total</th><td>{overview.appointmentCount}</td></tr></tfoot></table></div>}
        <p className="analytics-timestamp">Updated {new Date(overview.generatedAt).toLocaleString()}</p>
      </section>
      <section className="dashboard-card" aria-labelledby="admin-scheduling-title">
        <div className="card-heading"><div><p className="eyebrow">SCHEDULING</p><h2 id="admin-scheduling-title">Schedule a consultation</h2></div></div>
        <p className="form-help">Times use your browser's local time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}). Internal administrative notes are not shown to patients or doctors.</p>
        {scheduleError && <p className="notice notice-error" role="alert">{scheduleError}</p>}
        {scheduleNotice && <p className="notice notice-success" role="status">{scheduleNotice}</p>}
        <form className="profile-form" onSubmit={(event) => void scheduleAppointment(event)}>
          <div className="form-row">
            <label>Patient<select name="patientId" required defaultValue=""><option value="" disabled>Select a patient</option>{scheduleOptions.patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.email}</option>)}</select></label>
            <label>Doctor<select name="doctorId" required defaultValue=""><option value="" disabled>Select an approved doctor</option>{scheduleOptions.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.email}</option>)}</select></label>
          </div>
          <div className="form-row">
            <label>Start date and time<input name="startsAt" type="datetime-local" required /></label>
            <label>End date and time<input name="endsAt" type="datetime-local" required /></label>
          </div>
          <label>Appointment type<select name="type" defaultValue="video"><option value="video">Video consultation</option><option value="in_person">In person</option></select></label>
          <label>Consultation reason or scheduling note<input name="schedulingNote" maxLength={1000} /></label>
          <label>Internal admin note<textarea name="adminNote" maxLength={2000} rows={2} /></label>
          <button className="primary-button" type="submit" disabled={scheduleBusy}>{scheduleBusy ? "Scheduling…" : "Schedule appointment"}</button>
        </form>
        <h3>Scheduled appointments</h3>
        {adminAppointments.length === 0 ? <p className="notification-empty">No appointments found.</p> : <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Type / status</th><th>Actions</th></tr></thead><tbody>{adminAppointments.map((appointment) => <tr key={appointment.id}><td>{new Date(appointment.startsAt).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"})</td><td>{appointment.patientDisplayName}<br />{appointment.patientEmail}</td><td>{appointment.doctorDisplayName}<br />{appointment.doctorEmail}</td><td>{appointment.type.replace("_", " ")} / {appointment.status}</td><td>{["booked", "confirmed"].includes(appointment.status) && <><button className="secondary-button" type="button" onClick={() => { setReschedulingId(reschedulingId === appointment.id ? "" : appointment.id); setRescheduleTimes({ startsAt: new Date(new Date(appointment.startsAt).getTime() - new Date(appointment.startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16), endsAt: new Date(new Date(appointment.endsAt).getTime() - new Date(appointment.endsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) }); }}>Reschedule</button> <button className="secondary-button" type="button" onClick={() => void cancelAppointment(appointment.id)}>Cancel</button></>}{reschedulingId === appointment.id && <form className="profile-form" onSubmit={(event) => void rescheduleAppointment(event, appointment.id)}><label>New start<input type="datetime-local" required value={rescheduleTimes.startsAt} onChange={(event) => setRescheduleTimes((current) => ({ ...current, startsAt: event.target.value }))} /></label><label>New end<input type="datetime-local" required value={rescheduleTimes.endsAt} onChange={(event) => setRescheduleTimes((current) => ({ ...current, endsAt: event.target.value }))} /></label><button className="primary-button" type="submit">Save new time</button></form>}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
    <section className="dashboard-card admin-approval-card" aria-labelledby="doctor-approvals-heading">
      <div className="card-heading"><div><p className="eyebrow">DOCTOR ONBOARDING</p><h2 id="doctor-approvals-heading">Pending doctor applications</h2></div><button className="text-button" type="button" onClick={() => void loadPendingDoctors()} disabled={pendingLoading}>Refresh</button></div>
      {pendingError && <div className="notice notice-error" role="alert"><span>{pendingError}</span><button className="text-button" type="button" onClick={() => void loadPendingDoctors()}>Retry</button></div>}
      {decisionError && <p className="notice notice-error" role="alert">{decisionError}</p>}
      {decisionNotice && <p className="notice notice-success" role="status">{decisionNotice}</p>}
      {pendingLoading ? <section className="loading-card" role="status"><span className="spinner" />Loading pending doctor applications…</section>
        : pendingError ? null
          : pendingDoctors.length === 0 ? <p className="notification-empty">No pending doctor applications.</p>
            : <ul className="doctor-approval-list">{pendingDoctors.map((doctor) => {
              const name = `${doctor.givenName} ${doctor.familyName}`;
              return <li className="doctor-approval-item" key={doctor.id}>
                <div><h3>Dr. {name}</h3><p>{doctor.specialization}{doctor.qualification ? ` · ${doctor.qualification}` : ""}{doctor.experienceYears !== null ? ` · ${doctor.experienceYears} years’ experience` : ""}</p>{doctor.bio && <p>{doctor.bio}</p>}</div>
                <div className="doctor-approval-actions" aria-label={`Approval actions for Dr. ${name}`}>
                  <button className="primary-button" type="button" aria-label={`Approve Dr. ${name}`} disabled={Boolean(decisionInProgress)} onClick={() => void decideDoctor(doctor, "approved")}>{decisionInProgress === doctor.id ? "Saving…" : "Approve"}</button>
                  <button className="secondary-button" type="button" aria-label={`Reject Dr. ${name}`} disabled={Boolean(decisionInProgress)} onClick={() => void decideDoctor(doctor, "rejected")}>Reject</button>
                  <button className="secondary-button" type="button" aria-label={`Suspend Dr. ${name}`} disabled={Boolean(decisionInProgress)} onClick={() => void decideDoctor(doctor, "suspended")}>Suspend</button>
                </div>
              </li>;
            })}</ul>}
    </section>
    <section className="dashboard-card admin-users-card" aria-labelledby="admin-users-heading">
      <div className="card-heading"><div><p className="eyebrow">ACCOUNT ADMINISTRATION</p><h2 id="admin-users-heading">Users</h2></div><button className="text-button" type="button" onClick={() => void loadUsers(userSearch, userRole, userStatus)} disabled={usersLoading}>Refresh</button></div>
      <form className="admin-user-filters" onSubmit={(event) => { event.preventDefault(); void loadUsers(userSearch, userRole, userStatus); }}>
        <label>Search email<input type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} maxLength={254} /></label>
        <label>Role<select value={userRole} onChange={(event) => setUserRole(event.target.value)}><option value="">All roles</option><option>Patient</option><option>Doctor</option><option>Admin</option></select></label>
        <label>Status<select value={userStatus} onChange={(event) => setUserStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="locked">Locked</option></select></label>
        <button className="primary-button" type="submit" disabled={usersLoading}>Apply filters</button>
      </form>
      {usersError && <p className="notice notice-error" role="alert">{usersError}</p>}
      {userNotice && <p className="notice notice-success" role="status">{userNotice}</p>}
      {usersLoading ? <section className="loading-card" role="status"><span className="spinner" />Loading users…</section>
        : usersError ? null
          : users.length === 0 ? <p className="notification-empty">No users match these filters.</p>
            : <div className="analytics-table-wrap"><table className="analytics-table admin-user-table"><caption className="visually-hidden">User accounts and account status controls</caption><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Created</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><th scope="row">{user.email}</th><td>{user.role}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><label className="visually-hidden" htmlFor={`user-status-${user.id}`}>Status for {user.email}</label><select id={`user-status-${user.id}`} value={user.status} onChange={(event) => void updateUserStatus(user, event.target.value as ManagedUser["status"])} disabled={userStatusBusy === user.id}><option value="active">Active</option><option value="inactive">Inactive</option><option value="locked">Locked</option></select></td><td>{userStatusBusy === user.id ? <span role="status">Saving…</span> : user.status}</td></tr>)}</tbody></table></div>}
      <p className="form-help">Role changes and account creation are not available here. The last active Admin and your own account cannot be deactivated.</p>
    </section>
    <section className="dashboard-card admin-services-card" aria-labelledby="admin-services-heading">
      <div className="card-heading"><div><p className="eyebrow">LIVE CHECKS</p><h2 id="admin-services-heading">Service status</h2></div><button className="text-button" type="button" onClick={() => void loadServices()} disabled={servicesLoading}>Refresh</button></div>
      {servicesError && <p className="notice notice-error" role="alert">{servicesError}</p>}
      {servicesLoading ? <section className="loading-card" role="status"><span className="spinner" />Checking services…</section>
        : servicesError ? null
          : <ul className="service-status-list">{services.map((service) => <li key={service.name}><div><strong>{service.name}</strong><p>{service.detail}</p><time dateTime={service.checkedAt}>Checked {new Date(service.checkedAt).toLocaleString()}</time></div><span className={`service-status service-status-${service.status}`}>{service.status.replace("_", " ")}{service.responseTimeMs !== null ? ` · ${service.responseTimeMs} ms` : ""}</span></li>)}</ul>}
      <p className="form-help">The API and PostgreSQL are checked directly. Optional integrations are reported as not configured when no adapter exists.</p>
    </section>
  </main>;
}
