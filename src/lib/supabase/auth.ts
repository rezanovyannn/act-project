import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthUser, IAuthService, SignUpResult } from "@/core/ports";

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
    over_email_send_rate_limit: "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.",
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

  async signIn(email: string, password: string): Promise<AuthUser> {
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
  }
}
