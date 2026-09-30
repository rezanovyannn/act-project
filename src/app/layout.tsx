import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { configurationError } from "@/lib/supabase/config";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pembukuan",
  description: "Akuntansi pribadi multi-workspace berbasis akrual (SAK EMKM)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const configError = configurationError();
  return (
    <html lang="id" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {configError ? (
          <main role="alert" className="mx-auto grid w-full max-w-xl gap-3 px-4 py-16">
            <h1 className="text-2xl font-bold">Konfigurasi belum lengkap</h1>
            <p className="text-sm text-muted-foreground">{configError}</p>
            <p className="text-sm text-muted-foreground">
              Isi keduanya di pengaturan environment variable hosting, lalu deploy ulang. Aplikasi tidak memakai
              data contoh agar data Anda tidak tersimpan di tempat yang salah.
            </p>
          </main>
        ) : (
          children
        )}
        <Toaster position="top-right" richColors={false} />
      </body>
    </html>
  );
}
