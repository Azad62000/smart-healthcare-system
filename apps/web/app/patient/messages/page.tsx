import { redirect } from "next/navigation";

export default function PatientMessagesRedirect() {
  redirect("/patient/appointments");
}
