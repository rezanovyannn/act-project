import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthUser, IAuthService, SignUpResult } from "@/core/ports";
import { REMEMBER_COOKIE } from "./session-cookies";

const toUser = (user: User): AuthUser => ({ id: user.id, email: user.email ?? null });

/** Pesan error Supabase Auth dalam Bahasa Indonesia. */
function authError(error: AuthError): Error {
  const code = error.code ?? "";
  const messages: Record<string, string> = {
    invalid_credentials: "Email atau kata sandi salah",
    user_already_exists: "Email sudah terdaftar. Silakan masuk.",
    email_exists: "Email sudah terdaftar. Silakan masuk.",
    weak_password: "Kata sandi terlalu lemah (minimal 6 karakter)",
    email_not_confirmed: "Email belum dikonfirmasi. Periksa kotak masuk email Anda.",
    email_address_invalid: "Format email tidak valid",
    over_request_rate_limit: "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.",
    over_email_send_rate_limit: "Terlalu banyak permintaan email. Coba lagi beberapa menit lagi.",
    same_password: "Kata sandi baru harus berbeda dari kata sandi lama",
    session_not_found: "Sesi pemulihan tidak ditemukan atau kedaluwarsa. Minta tautan baru.",
  };
  return new Error(messages[code] ?? `Gagal autentikasi: ${error.message}`);
}

export class SupabaseAuthService implements IAuthService {
  constructor(private readonly client: SupabaseClient) {}

  async currentUser(): Promise<AuthUser | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return null;
    return toUser(data.user);
  }

  async signIn(email: string, password: string, options: { remember?: boolean } = {}): Promise<AuthUser> {
    // Penanda dipasang sebelum login agar cookie sesi langsung ditulis sesuai pilihan.
    document.cookie =
      options.remember === false ? `${REMEMBER_COOKIE}=0; Path=/; SameSite=Lax` : `${REMEMBER_COOKIE}=; Path=/; Max-Age=0`;
    const { data, error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw authError(error);
    return toUser(data.user);
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp({ email: email.trim(), password });
    if (error) throw authError(error);
    return {
      user: data.user ? toUser(data.user) : null,
      needsEmailConfirmation: !data.session,
    };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw authError(error);
    document.cookie = `${REMEMBER_COOKIE}=; Path=/; Max-Age=0`;
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw authError(error);
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw authError(error);
  }
}
