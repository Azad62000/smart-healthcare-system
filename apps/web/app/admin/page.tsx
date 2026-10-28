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
  licenseStatus?: "missing" | "pending" | "verified" | "rejected";
  licenseNumber?: string | null;
  licenseJurisdiction?: string | null;
  licenseReviewNote?: string | null;
  isSynthetic?: boolean;
  approvalStatus: "pending" | "approved" | "rejected" | "suspended";
};
type ManagedUser = { id: string; email: string; role: "Patient" | "Doctor" | "Admin"; status: "active" | "inactive" | "locked"; createdAt: string; patientProfileComplete?: boolean; doctorApprovalStatus?: string | null; specialization?: string | null; qualification?: string | null; experienceYears?: number | null; city?: string | null; consultationFeeInr?: number | null };
type ServiceHealth = { name: string; status: "healthy" | "unavailable" | "configured" | "not_configured"; checkedAt: string; responseTimeMs: number | null; detail: string };
type SchedulingOption = { id: string; name: string; email: string };
type ScheduleDoctor = SchedulingOption & { specialization: string; qualification: string | null; experienceYears: number | null; city: string | null; consultationFeeInr: number | null; available: boolean; unavailableReason: string | null; conflicts: Array<{ startsAt: string; endsAt: string; patientName: string }> };
type AdminAppointment = {
  id: string; patientDisplayName: string; patientEmail: string; doctorDisplayName: string; doctorEmail: string;
  startsAt: string; endsAt: string; status: string; type: "in_person" | "video";
  schedulingNote: string | null; adminNote: string | null;
};
type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
type RecordDetail = { kind: "patient" | "doctor" | "account"; user: ManagedUser } | { kind: "appointment"; appointment: AdminAppointment };

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
  const [userPagination, setUserPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
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
  const [appointmentPagination, setAppointmentPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [appointmentListView, setAppointmentListView] = useState<"all" | "pending" | "upcoming">("all");
  const [appointmentStatusFilter, setAppointmentStatusFilter] = useState("");
  const [appointmentDateRange, setAppointmentDateRange] = useState({ from: "", to: "" });
  const [recordDetail, setRecordDetail] = useState<RecordDetail | null>(null);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [reschedulingId, setReschedulingId] = useState("");
  const [rescheduleTimes, setRescheduleTimes] = useState({ startsAt: "", endsAt: "" });
  const [scheduleTimes, setScheduleTimes] = useState({ startsAt: "", endsAt: "" });
  const [scheduleType, setScheduleType] = useState<"video" | "in_person">("video");
  const [doctorSpecialization, setDoctorSpecialization] = useState("");
  const [doctorCity, setDoctorCity] = useState("");
  const [minimumExperience, setMinimumExperience] = useState("");
  const [maximumFee, setMaximumFee] = useState("");
  const [scheduleDoctors, setScheduleDoctors] = useState<ScheduleDoctor[]>([]);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [recordView, setRecordView] = useState<"patients" | "doctors" | "appointments" | "pending" | "upcoming" | null>(null);

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

  const loadUsers = useCallback(async (search: string, role: string, status: string, page = 1, profileFilter: "patients" | "approved-doctors" | null = null) => {
    setUsersLoading(true); setUsersError("");
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set("search", search.trim());
      if (role) query.set("role", role);
      if (status) query.set("status", status);
      if (profileFilter === "patients") query.set("patientProfileComplete", "true");
      if (profileFilter === "approved-doctors") query.set("doctorApprovalStatus", "approved");
      query.set("page", String(page)); query.set("pageSize", "25");
      const data = await apiData<{ users: ManagedUser[]; pagination: Pagination }>(`/api/v1/admin/users?${query}`);
      setUsers(data.users);
      setUserPagination(data.pagination ?? { page, pageSize: 25, total: data.users.length, totalPages: 1 });
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
  const loadScheduleOptions = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/admin/appointments/options`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Scheduling options could not be loaded.");
      setScheduleOptions(body.data);
    } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Scheduling options could not be loaded."); }
  }, []);
  const loadAppointments = useCallback(async (page = 1, view: "all" | "pending" | "upcoming" = "all", status = "", from = "", to = "") => {
    setScheduleError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "25", view });
      if (status) query.set("status", status);
      if (from) query.set("from", new Date(`${from}T00:00`).toISOString());
      if (to) query.set("to", new Date(`${to}T23:59:59.999`).toISOString());
      const appointmentsResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/admin/appointments?${query}`, { credentials: "include" });
      const appointmentsBody = await appointmentsResponse.json();
      if (!appointmentsResponse.ok) throw new Error(appointmentsBody.error?.message ?? "Appointments could not be loaded.");
      setAdminAppointments(appointmentsBody.data.appointments);
      setAppointmentPagination(appointmentsBody.data.pagination ?? { page, pageSize: 25, total: appointmentsBody.data.appointments.length, totalPages: 1 });
      setAppointmentListView(view);
    } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Appointments could not be loaded."); }
  }, []);

  async function checkDoctorAvailability() {
    if (!scheduleTimes.startsAt || !scheduleTimes.endsAt || new Date(scheduleTimes.endsAt) <= new Date(scheduleTimes.startsAt)) {
      setScheduleError("Choose a valid start and end time before checking availability.");
      return;
    }
    setAvailabilityLoading(true); setScheduleError(""); setAvailabilityChecked(false);
    try {
      const query = new URLSearchParams({ startsAt: new Date(scheduleTimes.startsAt).toISOString(), endsAt: new Date(scheduleTimes.endsAt).toISOString(), type: scheduleType });
      if (doctorSpecialization.trim()) query.set("specialization", doctorSpecialization.trim());
      if (doctorCity.trim()) query.set("city", doctorCity.trim());
      if (minimumExperience) query.set("minimumExperience", minimumExperience);
      if (maximumFee) query.set("maximumFee", maximumFee);
      const data = await apiData<{ doctors: ScheduleDoctor[] }>(`/api/v1/admin/appointments/availability?${query}`);
      setScheduleDoctors(data.doctors);
      setAvailabilityChecked(true);
      setSelectedDoctorId((current) => data.doctors.some((doctor) => doctor.id === current && doctor.available) ? current : "");
    } catch (cause) { setScheduleError(cause instanceof Error ? cause.message : "Doctor availability could not be checked."); }
    finally { setAvailabilityLoading(false); }
  }

  async function showRecords(view: NonNullable<typeof recordView>) {
    setRecordView(view);
    if (view === "patients") await loadUsers("", "Patient", "", 1, "patients");
    if (view === "doctors") await loadUsers("", "Doctor", "", 1, "approved-doctors");
    if (["appointments", "pending", "upcoming"].includes(view)) {
      setAppointmentStatusFilter("");
      setAppointmentDateRange({ from: "", to: "" });
      const listView = view === "appointments" ? "all" : view === "pending" ? "pending" : "upcoming";
      await loadAppointments(1, listView);
    }
  }

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadPendingDoctors(); }, [loadPendingDoctors]);
  useEffect(() => { void loadUsers("", "", "", 1); }, [loadUsers]);
  useEffect(() => { void loadServices(); }, [loadServices]);
  useEffect(() => { void loadScheduleOptions(); }, [loadScheduleOptions]);
  useEffect(() => { void loadAppointments(1, "all"); }, [loadAppointments]);

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
          doctorId: selectedDoctorId,
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
      setSelectedDoctorId(""); setAvailabilityChecked(false); setScheduleDoctors([]); setScheduleTimes({ startsAt: "", endsAt: "" });
      await Promise.all([loadAppointments(), loadOverview()]);
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
      await Promise.all([loadAppointments(), loadOverview()]);
      if (availabilityChecked) void checkDoctorAvailability();
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
      await Promise.all([loadAppointments(), loadOverview()]);
      if (availabilityChecked) void checkDoctorAvailability();
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
      void loadOverview();
    } catch (cause) { setDecisionError(cause instanceof Error ? cause.message : "Doctor approval status could not be updated."); }
    finally { setDecisionInProgress(""); }
  }

  async function reviewDoctorLicense(doctor: PendingDoctor, status: "verified" | "rejected") {
    const evidence = window.prompt(status === "verified" ? "Enter the official registry URL or reference used for verification:" : "Enter the source or reason for rejecting this license:");
    if (!evidence?.trim()) return;
    setDecisionInProgress(doctor.id); setDecisionError(""); setDecisionNotice("");
    try {
      const data = await apiData<{ profile: PendingDoctor }>(`/api/v1/doctors/${doctor.id}/license-review`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, note: evidence.trim() }) });
      setPendingDoctors((current) => status === "verified" && data.profile.approvalStatus === "approved"
        ? current.filter((entry) => entry.id !== doctor.id)
        : current.map((entry) => entry.id === doctor.id ? { ...entry, ...data.profile } : entry));
      setDecisionNotice(`License for Dr. ${doctor.givenName} ${doctor.familyName} marked ${status}.`);
    } catch (cause) { setDecisionError(cause instanceof Error ? cause.message : "License review could not be saved."); }
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
        <button className="dashboard-card metric-card metric-card-button" type="button" aria-expanded={recordView === "patients"} onClick={() => void showRecords("patients")}><span className="eyebrow">PATIENTS</span><strong>{overview.patientCount}</strong><span>Registered patient profiles · View records</span></button>
        <button className="dashboard-card metric-card metric-card-button" type="button" aria-expanded={recordView === "doctors"} onClick={() => void showRecords("doctors")}><span className="eyebrow">APPROVED DOCTORS</span><strong>{overview.approvedDoctorCount}</strong><span>Listed for patient booking · View records</span></button>
        <button className="dashboard-card metric-card metric-card-button" type="button" aria-expanded={recordView === "appointments"} onClick={() => void showRecords("appointments")}><span className="eyebrow">APPOINTMENTS</span><strong>{overview.appointmentCount}</strong><span>All appointment records · View records</span></button>
        <button className="dashboard-card metric-card metric-card-button" type="button" aria-expanded={recordView === "pending"} onClick={() => void showRecords("pending")}><span className="eyebrow">PENDING</span><strong>{overview.pendingAppointmentCount}</strong><span>Future bookings awaiting confirmation · View records</span></button>
        <button className="dashboard-card metric-card metric-card-button" type="button" aria-expanded={recordView === "upcoming"} onClick={() => void showRecords("upcoming")}><span className="eyebrow">UPCOMING</span><strong>{overview.upcomingAppointmentCount}</strong><span>Booked or confirmed from now · View records</span></button>
      </section>
      {recordView && <section className="dashboard-card admin-records-card" aria-labelledby="admin-records-title">
        <div className="card-heading"><div><p className="eyebrow">RECORDS</p><h2 id="admin-records-title">{recordView === "patients" ? "Registered patients" : recordView === "doctors" ? "Approved doctors" : recordView === "appointments" ? "All appointments" : recordView === "pending" ? "Pending appointments" : "Upcoming appointments"}</h2></div><button className="text-button" type="button" onClick={() => setRecordView(null)}>Close</button></div>
        {recordView === "patients" && (usersLoading ? <p role="status">Loading patients…</p> : usersError ? <p className="notice notice-error" role="alert">{usersError}</p> : users.length === 0 ? <p className="notification-empty">No registered patient profiles found.</p> : <><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Patient account</th><th>Registered</th><th>Account status</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><th><button className="record-link" type="button" onClick={() => setRecordDetail({ kind: "patient", user })}>{user.email}</button></th><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><span className={`record-status record-status-${user.status}`}>{user.status}</span></td></tr>)}</tbody></table></div><PaginationControls pagination={userPagination} onPage={(page) => void loadUsers("", "Patient", "", page, "patients")} /></>)}
        {recordView === "doctors" && (usersLoading ? <p role="status">Loading approved doctors…</p> : usersError ? <p className="notice notice-error" role="alert">{usersError}</p> : users.length === 0 ? <p className="notification-empty">No approved doctors found.</p> : <><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Doctor account</th><th>Specialization</th><th>Qualification</th><th>Experience</th><th>City</th><th>Fee</th><th>Account status</th></tr></thead><tbody>{users.map((doctor) => <tr key={doctor.id}><th><button className="record-link" type="button" onClick={() => setRecordDetail({ kind: "doctor", user: doctor })}>{doctor.email}</button></th><td>{doctor.specialization ?? "—"}</td><td>{doctor.qualification ?? "—"}</td><td>{doctor.experienceYears ?? "—"}</td><td>{doctor.city ?? "—"}</td><td>{doctor.consultationFeeInr == null ? "—" : `₹${doctor.consultationFeeInr}`}</td><td><span className={`record-status record-status-${doctor.status}`}>{doctor.status}</span></td></tr>)}</tbody></table></div><PaginationControls pagination={userPagination} onPage={(page) => void loadUsers("", "Doctor", "", page, "approved-doctors")} /></>)}
        {(recordView === "appointments" || recordView === "pending" || recordView === "upcoming") && <div className="admin-record-filters">
          {recordView === "appointments" && <label className="record-filter-label">Status<select value={appointmentStatusFilter} onChange={(event) => { const status = event.target.value; setAppointmentStatusFilter(status); void loadAppointments(1, "all", status, appointmentDateRange.from, appointmentDateRange.to); }}><option value="">All statuses</option><option value="booked">Booked</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option><option value="no_show">No show</option></select></label>}
          <label className="record-filter-label">From<input type="date" value={appointmentDateRange.from} onChange={(event) => { const from = event.target.value; setAppointmentDateRange((current) => ({ ...current, from })); void loadAppointments(1, appointmentListView, appointmentStatusFilter, from, appointmentDateRange.to); }} /></label>
          <label className="record-filter-label">Through<input type="date" value={appointmentDateRange.to} onChange={(event) => { const to = event.target.value; setAppointmentDateRange((current) => ({ ...current, to })); void loadAppointments(1, appointmentListView, appointmentStatusFilter, appointmentDateRange.from, to); }} /></label>
        </div>}
        {(recordView === "appointments" || recordView === "pending" || recordView === "upcoming") && (() => {
          const now = Date.now();
          const records = adminAppointments.filter((appointment) => recordView === "appointments" || (recordView === "pending" ? appointment.status === "booked" && Date.parse(appointment.startsAt) >= now : ["booked", "confirmed"].includes(appointment.status) && Date.parse(appointment.startsAt) >= now));
          return records.length === 0 ? <p className="notification-empty">No matching appointments found.</p> : <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Appointment</th><th>Patient</th><th>Doctor</th><th>Status</th><th>Type</th></tr></thead><tbody>{records.map((appointment) => <tr key={appointment.id}><th><button className="record-link" type="button" onClick={() => setRecordDetail({ kind: "appointment", appointment })}>{new Date(appointment.startsAt).toLocaleString()}</button></th><td>{appointment.patientDisplayName}<br />{appointment.patientEmail}</td><td>{appointment.doctorDisplayName}<br />{appointment.doctorEmail}</td><td><span className={`record-status record-status-${appointment.status}`}>{appointment.status}</span></td><td>{appointment.type.replace("_", " ")}</td></tr>)}</tbody></table></div>;
        })()}
        {(recordView === "appointments" || recordView === "pending" || recordView === "upcoming") && <PaginationControls pagination={appointmentPagination} onPage={(page) => void loadAppointments(page, appointmentListView, appointmentStatusFilter, appointmentDateRange.from, appointmentDateRange.to)} />}
      </section>}
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
            <label>Appointment type<select name="type" value={scheduleType} onChange={(event) => { setScheduleType(event.target.value as "video" | "in_person"); setAvailabilityChecked(false); }}><option value="video">Video consultation</option><option value="in_person">In person</option></select></label>
          </div>
          <div className="form-row">
            <label>Start date and time<input name="startsAt" type="datetime-local" required value={scheduleTimes.startsAt} onChange={(event) => { setScheduleTimes((value) => ({ ...value, startsAt: event.target.value })); setAvailabilityChecked(false); }} /></label>
            <label>End date and time<input name="endsAt" type="datetime-local" required value={scheduleTimes.endsAt} onChange={(event) => { setScheduleTimes((value) => ({ ...value, endsAt: event.target.value })); setAvailabilityChecked(false); }} /></label>
          </div>
          <fieldset className="admin-doctor-filters"><legend>Doctor filters</legend><div className="form-row">
            <label>Specialization<input minLength={2} value={doctorSpecialization} onChange={(event) => { setDoctorSpecialization(event.target.value); setAvailabilityChecked(false); }} placeholder="e.g. Cardiology" /></label>
            <label>City<input minLength={2} value={doctorCity} onChange={(event) => { setDoctorCity(event.target.value); setAvailabilityChecked(false); }} placeholder="Any city" /></label>
            <label>Minimum experience (years)<input type="number" min="0" max="60" value={minimumExperience} onChange={(event) => { setMinimumExperience(event.target.value); setAvailabilityChecked(false); }} /></label>
            <label>Maximum fee (INR)<input type="number" min="0" value={maximumFee} onChange={(event) => { setMaximumFee(event.target.value); setAvailabilityChecked(false); }} /></label>
          </div></fieldset>
          <button className="secondary-button" type="button" onClick={() => void checkDoctorAvailability()} disabled={availabilityLoading || !scheduleTimes.startsAt || !scheduleTimes.endsAt}>{availabilityLoading ? "Checking doctors…" : "Check doctor availability"}</button>
          {availabilityChecked && <>
            <label>Available doctor<select name="doctorId" required value={selectedDoctorId} onChange={(event) => setSelectedDoctorId(event.target.value)}><option value="">{scheduleDoctors.some((doctor) => doctor.available) ? "Select an available doctor" : "No doctor available for this slot"}</option>{scheduleDoctors.filter((doctor) => doctor.available).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.specialization}{doctor.city ? ` · ${doctor.city}` : ""}{doctor.experienceYears !== null ? ` · ${doctor.experienceYears} yrs` : ""}</option>)}</select></label>
            {scheduleDoctors.filter((doctor) => !doctor.available).length > 0 && <section className="admin-busy-doctors" aria-label="Doctors unavailable for selected time"><h3>Unavailable for this time</h3><ul>{scheduleDoctors.filter((doctor) => !doctor.available).map((doctor) => <li key={doctor.id}><strong>Dr. {doctor.name}</strong> · {doctor.specialization} — {doctor.unavailableReason === "already_booked" ? "Already booked" : doctor.unavailableReason === "outside_availability" ? "Outside published availability" : "Not accepting appointments"}{doctor.conflicts.map((conflict) => <span className="form-help" key={`${conflict.startsAt}-${conflict.endsAt}`}>Booked {new Date(conflict.startsAt).toLocaleString()}–{new Date(conflict.endsAt).toLocaleTimeString()} · {conflict.patientName}</span>)}</li>)}</ul></section>}
            {scheduleDoctors.length === 0 && <p className="notification-empty">No approved doctors match these filters.</p>}
          </>}
          <label>Consultation reason or scheduling note<input name="schedulingNote" maxLength={1000} /></label>
          <label>Internal admin note<textarea name="adminNote" maxLength={2000} rows={2} /></label>
          <button className="primary-button" type="submit" disabled={scheduleBusy || !availabilityChecked || !selectedDoctorId}>{scheduleBusy ? "Scheduling…" : "Schedule appointment"}</button>
        </form>
        {!(["appointments", "pending", "upcoming"] as string[]).includes(recordView ?? "") && <><h3>Scheduled appointments</h3>
        {adminAppointments.length === 0 ? <p className="notification-empty">No appointments found.</p> : <><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Appointment</th><th>Patient</th><th>Doctor</th><th>Type / status</th><th>Actions</th></tr></thead><tbody>{adminAppointments.map((appointment) => <tr key={appointment.id}><th><button className="record-link" type="button" onClick={() => setRecordDetail({ kind: "appointment", appointment })}>{new Date(appointment.startsAt).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"})</button></th><td>{appointment.patientDisplayName}<br />{appointment.patientEmail}</td><td>{appointment.doctorDisplayName}<br />{appointment.doctorEmail}</td><td>{appointment.type.replace("_", " ")} / {appointment.status}</td><td>{["booked", "confirmed"].includes(appointment.status) && <><button className="secondary-button" type="button" onClick={() => { setReschedulingId(reschedulingId === appointment.id ? "" : appointment.id); setRescheduleTimes({ startsAt: new Date(new Date(appointment.startsAt).getTime() - new Date(appointment.startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16), endsAt: new Date(new Date(appointment.endsAt).getTime() - new Date(appointment.endsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) }); }}>Reschedule</button> <button className="secondary-button" type="button" onClick={() => void cancelAppointment(appointment.id)}>Cancel</button></>}{reschedulingId === appointment.id && <form className="profile-form" onSubmit={(event) => void rescheduleAppointment(event, appointment.id)}><label>New start<input type="datetime-local" required value={rescheduleTimes.startsAt} onChange={(event) => setRescheduleTimes((current) => ({ ...current, startsAt: event.target.value }))} /></label><label>New end<input type="datetime-local" required value={rescheduleTimes.endsAt} onChange={(event) => setRescheduleTimes((current) => ({ ...current, endsAt: event.target.value }))} /></label><button className="primary-button" type="submit">Save new time</button></form>}</td></tr>)}</tbody></table></div><PaginationControls pagination={appointmentPagination} onPage={(page) => void loadAppointments(page, appointmentListView, appointmentStatusFilter, appointmentDateRange.from, appointmentDateRange.to)} /></>}
        </>}
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
                <div><h3>Dr. {name}</h3><p>{doctor.specialization}{doctor.qualification ? ` · ${doctor.qualification}` : ""}{doctor.experienceYears !== null ? ` · ${doctor.experienceYears} years’ experience` : ""}</p>{doctor.bio && <p>{doctor.bio}</p>}<p><strong>License:</strong> {doctor.licenseNumber || "Not submitted"} · {doctor.licenseJurisdiction || "Jurisdiction missing"} · review {doctor.licenseStatus ?? "pending"}</p>{doctor.licenseReviewNote && <p>Review note: {doctor.licenseReviewNote}</p>}<p className="form-help">Confirm this registration against the issuing authority’s official source before marking verified.</p></div>
                <div className="doctor-approval-actions" aria-label={`Approval actions for Dr. ${name}`}>
                  <button className="primary-button" type="button" disabled={Boolean(decisionInProgress) || !doctor.licenseNumber || !doctor.licenseJurisdiction} onClick={() => void reviewDoctorLicense(doctor, "verified")}>{decisionInProgress === doctor.id ? "Saving…" : "Mark license verified"}</button>
                  <button className="secondary-button" type="button" disabled={Boolean(decisionInProgress)} onClick={() => void reviewDoctorLicense(doctor, "rejected")}>Reject license</button>
                  <button className="primary-button" type="button" aria-label={`Approve Dr. ${name}`} disabled={Boolean(decisionInProgress) || (!doctor.isSynthetic && doctor.licenseStatus !== "verified")} onClick={() => void decideDoctor(doctor, "approved")}>{decisionInProgress === doctor.id ? "Saving…" : "Approve"}</button>
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
            : <><div className="analytics-table-wrap"><table className="analytics-table admin-user-table"><caption className="visually-hidden">User accounts and account status controls</caption><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Created</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><th scope="row"><button className="record-link" type="button" onClick={() => setRecordDetail({ kind: user.role === "Doctor" ? "doctor" : user.role === "Patient" ? "patient" : "account", user })}>{user.email}</button></th><td>{user.role}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><label className="visually-hidden" htmlFor={`user-status-${user.id}`}>Status for {user.email}</label><select id={`user-status-${user.id}`} value={user.status} onChange={(event) => void updateUserStatus(user, event.target.value as ManagedUser["status"])} disabled={userStatusBusy === user.id}><option value="active">Active</option><option value="inactive">Inactive</option><option value="locked">Locked</option></select></td><td>{userStatusBusy === user.id ? <span role="status">Saving…</span> : user.status}</td></tr>)}</tbody></table></div><PaginationControls pagination={userPagination} onPage={(page) => void loadUsers(userSearch, userRole, userStatus, page)} /></>}
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
    {recordDetail && <div className="record-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRecordDetail(null); }}><section className="record-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="record-detail-title"><header><div><p className="eyebrow">RECORD DETAILS</p><h2 id="record-detail-title">{recordDetail.kind === "patient" ? "Patient account" : recordDetail.kind === "doctor" ? "Doctor profile" : "Appointment details"}</h2></div><button className="text-button" type="button" aria-label="Close record details" onClick={() => setRecordDetail(null)}>Close</button></header>
      {recordDetail.kind !== "appointment" ? <dl className="record-detail-grid"><dt>Email</dt><dd>{recordDetail.user.email}</dd><dt>Role</dt><dd>{recordDetail.user.role}</dd><dt>Account status</dt><dd><span className={`record-status record-status-${recordDetail.user.status}`}>{recordDetail.user.status}</span></dd><dt>Registered</dt><dd>{new Date(recordDetail.user.createdAt).toLocaleString()}</dd>{recordDetail.kind === "patient" ? <><dt>Patient profile</dt><dd>{recordDetail.user.patientProfileComplete ? "Complete" : "Incomplete"}</dd></> : recordDetail.kind === "doctor" ? <><dt>Approval</dt><dd>{recordDetail.user.doctorApprovalStatus ?? "Not reviewed"}</dd><dt>Specialization</dt><dd>{recordDetail.user.specialization ?? "Not provided"}</dd><dt>Qualification</dt><dd>{recordDetail.user.qualification ?? "Not provided"}</dd><dt>Experience</dt><dd>{recordDetail.user.experienceYears == null ? "Not provided" : `${recordDetail.user.experienceYears} years`}</dd><dt>City</dt><dd>{recordDetail.user.city ?? "Not provided"}</dd><dt>Consultation fee</dt><dd>{recordDetail.user.consultationFeeInr == null ? "Not provided" : `₹${recordDetail.user.consultationFeeInr}`}</dd></> : null}</dl> : <dl className="record-detail-grid"><dt>Starts</dt><dd>{new Date(recordDetail.appointment.startsAt).toLocaleString()}</dd><dt>Ends</dt><dd>{new Date(recordDetail.appointment.endsAt).toLocaleString()}</dd><dt>Patient</dt><dd>{recordDetail.appointment.patientDisplayName} · {recordDetail.appointment.patientEmail}</dd><dt>Doctor</dt><dd>{recordDetail.appointment.doctorDisplayName} · {recordDetail.appointment.doctorEmail}</dd><dt>Status</dt><dd>{recordDetail.appointment.status}</dd><dt>Type</dt><dd>{recordDetail.appointment.type.replace("_", " ")}</dd><dt>Scheduling note</dt><dd>{recordDetail.appointment.schedulingNote || "None"}</dd><dt>Admin note</dt><dd>{recordDetail.appointment.adminNote || "None"}</dd></dl>}
    </section></div>}
  </main>;
}

function PaginationControls({ pagination, onPage }: { pagination: Pagination; onPage: (page: number) => void }) {
  if (pagination.totalPages <= 1) return <p className="pagination-count">{pagination.total} record{pagination.total === 1 ? "" : "s"}</p>;
  return <nav className="pagination-controls" aria-label="Record pages">
    <button className="secondary-button" type="button" onClick={() => onPage(pagination.page - 1)} disabled={pagination.page <= 1}>Previous</button>
    <span>Page {pagination.page} of {pagination.totalPages}<small>{pagination.total} records</small></span>
    <button className="secondary-button" type="button" onClick={() => onPage(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Next</button>
  </nav>;
}
