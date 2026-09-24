import {
  PatientsPage,
  patientsRoute,
  type PatientsRoute,
} from "./patients/patients-page";

export { patientsRoute, type PatientsRoute };

export function PatientsRouteView({
  hash,
}: {
  readonly baseUrl?: string;
  readonly hash: string;
}) {
  return <PatientsPage hash={hash} />;
}
