import type { Person } from "./types";

export type ProfileField = "birth_date" | "gender" | "phone";
export interface ClientAuthSession {
  authenticated: boolean;
  state: string;
  identity: Person | null;
  profileCompletionRequired: boolean;
  passwordResetRequired: boolean;
  profileMissingFields: ProfileField[];
  message: string;
}
export const AUTH_CHANGED_EVENT = "yebom-saint-checkin";
export const OPEN_LOGIN_EVENT = "yebom-open-login";
export const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  birth_date: "생년월일", gender: "성별", phone: "연락처",
};
