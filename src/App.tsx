import { useState, useRef, useEffect, useCallback } from "react"
import logoImg from "@/imports/PTSGN_LOGO.png"

// ── Database Akun ─────────────────────────────────────────────────────────────
type Role = "admin" | "user"

interface AccountRecord {
  email: string
  password: string
  role: Role
  name: string
  jabatan: string
  departemen: string
  nik: string
}

// ── API endpoints ─────────────────────────────────────────────────────────────
//    Semua URL DIBACA dari import.meta.env (file .env) supaya saat pindah ke
//    server perusahaan sendiri cukup mengganti satu file .env — TIDAK ADA URL
//    yang ditulis langsung (hardcoded) di kode komponen. Lihat .env / .env.example.
//    Nilai default (fallback) = URL produksi n8n saat ini, dipakai HANYA jika
//    .env hilang / gagal ter-load. Sumber utama tetap file .env.
const N8N_BASE = "https://ianrun47.app.n8n.cloud"
const N8N_REGISTER_URL =
  import.meta.env.VITE_REGISTER_URL ?? `${N8N_BASE}/webhook/register`
const N8N_LOGIN_URL =
  import.meta.env.VITE_LOGIN_URL ?? `${N8N_BASE}/webhook/login`
const N8N_CHAT_URL =
  import.meta.env.VITE_CHAT_URL ??
  `${N8N_BASE}/webhook/e1a8c29d-d4b5-4b4d-9156-f3625bbce403/chat`
const N8N_UPLOAD_SOP_URL =
  import.meta.env.VITE_UPLOAD_SOP_URL ?? `${N8N_BASE}/webhook/upload-sop`
const N8N_GET_SOP_DOCS_URL =
  import.meta.env.VITE_GET_SOP_DOCS_URL ?? `${N8N_BASE}/webhook/get-sop-docs`
const N8N_DELETE_SOP_URL =
  import.meta.env.VITE_DELETE_SOP_URL ?? `${N8N_BASE}/webhook/delete-sop`

async function proxiedFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  return fetch(url, options)
}
const N8N_UPLOAD_FORM_URL =
  import.meta.env.VITE_UPLOAD_URL ??
  "https://ianrun47.app.n8n.cloud/form/9cb0ce8b-2496-438a-8c67-859c790614e0"

// Domain email untuk deteksi role — juga dari env agar mudah diganti tanpa
// menyentuh kode saat migrasi ke domain / server lain. Fallback jaring pengaman.
const ADMIN_DOMAIN = import.meta.env.VITE_ADMIN_DOMAIN ?? "@admin.sgn.com"
const USER_DOMAIN = import.meta.env.VITE_USER_DOMAIN ?? "@sgn.com"

function detectRole(email: string): Role | null {
  const e = email.toLowerCase()
  if (e.endsWith(ADMIN_DOMAIN)) return "admin"
  if (e.endsWith(USER_DOMAIN) && !e.endsWith(ADMIN_DOMAIN)) return "user"
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
type Page = "login" | "dashboard" | "chat" | "history" | "profile" | "sop"

interface SopDoc {
  id: string
  title: string
  category: string
  fileName: string
  fileSize: number
  fileDataUrl: string
  uploadedAt: Date
  uploadedBy: string
}

interface SopRef {
  source: "SGN" | "Holding" | "Perpres" | "Permen"
  title: string
  chapter: string
  pages: string
  color: string
  badge: string
}

// File rujukan yang dikirim balik oleh endpoint chat (VITE_CHAT_URL).
// name  = nama SOP / dokumen yang ditampilkan ke user
// url   = link file asli yang bisa diunduh (http(s) atau data URL)
interface ReferencedFile {
  name: string
  url: string
}

interface Message {
  id: number
  role: "user" | "ai"
  text: string
  sopRefs?: SopRef[]
  referencedFiles?: ReferencedFile[]
  feedback?: "satisfied" | "unsatisfied" | null
  timestamp: Date
}

// Ekstrak daftar file rujukan dari response chat n8n secara defensif.
// Mendukung beberapa kemungkinan nama field tanpa membuat data dummy —
// jika backend belum mengirim data file, hasilnya array kosong.
function parseReferencedFiles(data: Record<string, unknown>): ReferencedFile[] {
  const raw =
    data.referencedFiles as unknown ??
    data.referenced_files as unknown ??
    data.files as unknown ??
    data.documents as unknown ??
    data.attachments as unknown ??
    data.sources as unknown
  if (!Array.isArray(raw)) return []
  const files: ReferencedFile[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const name =
      o.name as string ??
      o.fileName as string ??
      o.title as string ??
      o.label as string
    const url =
      o.url as string ??
      o.fileUrl as string ??
      o.downloadUrl as string ??
      o.fileDataUrl as string ??
      o.link as string ??
      o.href as string
    if (name && url) files.push({ name, url })
  }
  return files
}

interface ChatSession {
  id: string
  title: string
  messages: Message[]
  updatedAt: Date
}

interface UserProfile {
  name: string
  email: string
  jabatan: string
  departemen: string
  perusahaan: string
  nik: string
  photoUrl?: string
  role?: Role
}

const SOURCE_COLORS: Record<string, string> = {
  SGN: "#1e40af",
  Holding: "#7c3aed",
  Perpres: "#0369a1",
  Permen: "#0f766e",
}

const _DEMO_SESSIONS_UNUSED: ChatSession[] = [
  {
    id: "session-1",
    title: "Prosedur Pembuatan Purchase Order",
    updatedAt: new Date("2026-08-10T09:15:00"),
    messages: [
      {
        id: 1,
        role: "ai",
        text: "Halo! Ada yang bisa saya bantu terkait SOP perusahaan?",
        timestamp: new Date("2026-08-10T09:00:00"),
        feedback: null,
      },
      {
        id: 2,
        role: "user",
        text: "Bagaimana cara membuat Purchase Order untuk vendor baru?",
        timestamp: new Date("2026-08-10T09:01:00"),
        feedback: null,
      },
      {
        id: 3,
        role: "ai",
        timestamp: new Date("2026-08-10T09:01:30"),
        feedback: "satisfied",
        text: "Untuk membuat PO vendor baru, ikuti langkah berikut:\n\n1. **Pastikan Vendor Terdaftar** — Daftarkan vendor ke sistem e-procurement melalui modul Vendor Management.\n2. **Buat Purchase Request (PR)** — Ajukan PR dan tunggu persetujuan atasan.\n3. **Input Data PO** — Lengkapi kode vendor, deskripsi item, kuantitas, harga, dan tanggal kirim.\n4. **Proses Persetujuan** — PO > Rp 50 juta memerlukan dua tingkat persetujuan manajemen.",
        sopRefs: [
          {
            source: "SGN",
            title: "SOP Pengadaan Barang & Jasa No. SGN/PRO/001",
            chapter: "Bab 3 — Pembuatan PO",
            pages: "Hal. 12–15",
            color: "#1e40af",
            badge: "SGN",
          },
          {
            source: "Perpres",
            title: "Perpres No. 16 Tahun 2018 tentang Pengadaan",
            chapter: "Pasal 38 — Pengadaan Langsung",
            pages: "Pasal 38–40",
            color: "#0369a1",
            badge: "Perpres",
          },
        ],
      },
    ],
  },
  {
    id: "session-2",
    title: "Kebijakan Cuti Tahunan Karyawan",
    updatedAt: new Date("2026-08-09T14:30:00"),
    messages: [
      {
        id: 1,
        role: "ai",
        text: "Halo! Ada yang bisa saya bantu?",
        timestamp: new Date("2026-08-09T14:00:00"),
        feedback: null,
      },
      {
        id: 2,
        role: "user",
        text: "Berapa hari cuti tahunan untuk karyawan tetap?",
        timestamp: new Date("2026-08-09T14:01:00"),
        feedback: null,
      },
      {
        id: 3,
        role: "ai",
        text: "Karyawan tetap berhak mendapat 12 hari kerja cuti tahunan setelah 12 bulan masa kerja, sesuai UU Ketenagakerjaan No. 13 Tahun 2003 Pasal 79.",
        timestamp: new Date("2026-08-09T14:01:30"),
        feedback: null,
      },
    ],
  },
  {
    id: "session-3",
    title: "Prosedur Pengadaan Aset IT",
    updatedAt: new Date("2026-08-07T11:00:00"),
    messages: [
      {
        id: 1,
        role: "ai",
        text: "Halo! Ada yang bisa saya bantu?",
        timestamp: new Date("2026-08-07T11:00:00"),
        feedback: null,
      },
      {
        id: 2,
        role: "user",
        text: "Dokumen apa saja yang diperlukan untuk pengadaan laptop baru?",
        timestamp: new Date("2026-08-07T11:01:00"),
        feedback: null,
      },
      {
        id: 3,
        role: "ai",
        text: "Untuk pengadaan laptop, Anda perlu: (1) Form Permintaan Aset IT yang disetujui kepala departemen, (2) Justifikasi kebutuhan teknis, (3) Perbandingan minimal 3 vendor/harga.",
        timestamp: new Date("2026-08-07T11:01:30"),
        feedback: null,
      },
    ],
  },
  {
    id: "session-4",
    title: "Klaim Lembur dan Kompensasi",
    updatedAt: new Date("2026-08-05T16:20:00"),
    messages: [
      {
        id: 1,
        role: "ai",
        text: "Halo! Ada yang bisa saya bantu?",
        timestamp: new Date("2026-08-05T16:00:00"),
        feedback: null,
      },
      {
        id: 2,
        role: "user",
        text: "Bagaimana cara mengajukan klaim lembur?",
        timestamp: new Date("2026-08-05T16:01:00"),
        feedback: null,
      },
      {
        id: 3,
        role: "ai",
        text: "Klaim lembur diajukan melalui HRIS selambatnya H+3 setelah hari lembur, dengan persetujuan atasan langsung. Maksimal 3 jam/hari dan 14 jam/minggu sesuai regulasi.",
        timestamp: new Date("2026-08-05T16:01:30"),
        feedback: null,
      },
    ],
  },
  {
    id: "session-5",
    title: "Alur Persetujuan Anggaran Departemen",
    updatedAt: new Date("2026-08-02T09:45:00"),
    messages: [
      {
        id: 1,
        role: "ai",
        text: "Halo! Ada yang bisa saya bantu?",
        timestamp: new Date("2026-08-02T09:00:00"),
        feedback: null,
      },
      {
        id: 2,
        role: "user",
        text: "Siapa yang harus menyetujui anggaran departemen?",
        timestamp: new Date("2026-08-02T09:01:00"),
        feedback: null,
      },
      {
        id: 3,
        role: "ai",
        text: "Anggaran departemen melalui 3 tahap: (1) Kepala Departemen, (2) Direktur terkait, (3) CFO untuk nilai > Rp 500 juta. Pengajuan via sistem e-Budget paling lambat tanggal 20 setiap bulan.",
        timestamp: new Date("2026-08-02T09:01:30"),
        feedback: null,
      },
    ],
  },
]

function formatTime(date: Date) {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDate(date: Date) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return "Hari ini"
  if (date.toDateString() === yesterday.toDateString()) return "Kemarin"
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function renderInlineMarkdown(text: string, linkClassName: string) {
  return text
    .split(/(\*\*.*?\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g)
    .map((part, index) => {
      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        return (
          <a
            key={index}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            {link[1]}
          </a>
        )
      }

      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={index} style={{ fontWeight: 600 }}>
            {part.slice(2, -2)}
          </strong>
        )
      }

      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={index}>{part.slice(1, -1)}</em>
      }

      return part
    })
}

function renderMessageMarkdown(text: string, linkClassName: string) {
  const lines = text.split("\n")
  const content = []
  let bulletItems: string[] = []
  let blockIndex = 0

  const flushBullets = () => {
    if (bulletItems.length === 0) return
    const items = bulletItems
    content.push(
      <ul
        key={`list-${blockIndex++}`}
        className="list-disc pl-5 my-1 space-y-0.5"
      >
        {items.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item, linkClassName)}</li>
        ))}
      </ul>,
    )
    bulletItems = []
  }

  lines.forEach((line, index) => {
    const bullet = line.match(/^\s*-\s+(.*)$/)
    if (bullet) {
      bulletItems.push(bullet[1])
      return
    }

    flushBullets()
    content.push(
      <span key={`line-${blockIndex++}`}>
        {renderInlineMarkdown(line, linkClassName)}
        {index < lines.length - 1 && <br />}
      </span>,
    )
  })

  flushBullets()
  return content
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function SgnLogo({
  size = 32,
  withText = false,
}: {
  size?: number
  withText?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm"
        style={{ width: size, height: size }}
      >
        <img
          src={logoImg}
          alt="SGN"
          className="object-contain"
          style={{ width: size * 0.72, height: size * 0.72 }}
        />
      </div>
      {withText && (
        <div>
          <div
            className="text-white text-sm leading-tight"
            style={{ fontWeight: 700 }}
          >
            PT SGN
          </div>
          <div className="text-white/40 text-[10px]">AI Admin Assistant</div>
        </div>
      )}
    </div>
  )
}

// ── Register ──────────────────────────────────────────────────────────────────
function RegisterPage({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({
    email: "",
    name: "",
    nik: "",
    password: "",
    confirm: "",
  })
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  const set = (k: string, v: string) => {
    setForm((p) => ({ ...p, [k]: v }))
    setErrors((p) => ({ ...p, [k]: "" }))
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = "Nama wajib diisi"
    if (!form.email.trim()) e.email = "Email wajib diisi"
    else if (!detectRole(form.email))
      e.email = `Gunakan email domain ${USER_DOMAIN} atau ${ADMIN_DOMAIN}`
    if (!form.nik.trim()) e.nik = "NIK Pegawai wajib diisi"
    if (!form.password) e.password = "Kata sandi wajib diisi"
    else if (form.password.length < 8) e.password = "Minimal 8 karakter"
    if (!form.confirm) e.confirm = "Konfirmasi kata sandi wajib diisi"
    else if (form.confirm !== form.password)
      e.confirm = "Kata sandi tidak cocok"
    return e
  }

  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setSubmitting(true)
    try {
      const role = form.email.toLowerCase().endsWith(ADMIN_DOMAIN)
        ? "admin"
        : "user"
      const payload = {
        nama_lengkap: form.name,
        name: form.name,
        email: form.email.toLowerCase(),
        nik: form.nik,
        password: form.password,
        role,
      }
      // text/plain + no-cors = simple request, tidak ada CORS preflight
      // Response opaque (tidak bisa dibaca) — asumsikan sukses, data tersimpan di localStorage
      console.log("[Register] Sending to:", N8N_REGISTER_URL)
      await fetch(N8N_REGISTER_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
      })
      // Simpan data registrasi lokal agar profil terisi saat login
      try {
        const cache = JSON.parse(
          localStorage.getItem("sgn_profile_cache") ?? "{}",
        )
        cache[form.email.toLowerCase()] = {
          name: form.name,
          nik: form.nik,
          role,
        }
        localStorage.setItem("sgn_profile_cache", JSON.stringify(cache))
      } catch {}
      setSubmitted(true)
    } catch (err) {
      console.error("[Register] Error:", err)
      const msg = err instanceof Error ? err.message : String(err)
      setErrors({
        email: `Gagal mengirim data: ${msg}. Periksa koneksi internet Anda.`,
      })
      setSubmitting(false)
    }
  }

  const strength = (() => {
    const p = form.password
    if (!p) return 0
    let s = 0
    if (p.length >= 8) s++
    if (/[A-Z]/.test(p)) s++
    if (/[0-9]/.test(p)) s++
    if (/[^A-Za-z0-9]/.test(p)) s++
    return s
  })()
  const strengthLabel = ["", "Lemah", "Cukup", "Kuat", "Sangat Kuat"][strength]
  const strengthColor = ["", "#ef4444", "#f59e0b", "#10b981", "#1e40af"][
    strength
  ]

  const detectedRole = form.email.includes("@") ? detectRole(form.email) : null

  if (submitted)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] p-6">
        <div className="bg-white rounded-2xl shadow-xl p-10 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-[#e8f0fe] flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-[#1e40af]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2
            className="text-lg text-[#1e293b] mb-2"
            style={{ fontWeight: 700 }}
          >
            Pendaftaran Berhasil!
          </h2>
          <p className="text-sm text-[#64748b] mb-1">
            Akun{" "}
            <span className="text-[#1e40af]" style={{ fontWeight: 600 }}>
              {form.email}
            </span>{" "}
            berhasil didaftarkan.
          </p>
          <p className="text-xs text-[#94a3b8] mb-6">
            Silakan tunggu verifikasi dari Administrator sebelum dapat login.
          </p>
          <button
            onClick={onBack}
            className="w-full py-2.5 rounded-xl text-white text-sm"
            style={{
              fontWeight: 600,
              background:
                "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
            }}
          >
            Kembali ke Login
          </button>
        </div>
      </div>
    )

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Form */}
      <div className="flex flex-col justify-center items-center w-full lg:w-[45%] px-6 sm:px-14 py-12 bg-white min-h-screen lg:min-h-0">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center mb-8">
            <img
              src={logoImg}
              alt="SGN"
              className="w-16 h-16 object-contain mb-2"
            />
            <div
              className="text-[#1e40af] text-lg leading-tight"
              style={{ fontWeight: 700 }}
            >
              PT SGN
            </div>
            <div className="text-[#94a3b8] text-xs">AI Admin Assistant</div>
          </div>

          <h1
            className="text-2xl text-[#1e40af] mb-1"
            style={{ fontWeight: 700 }}
          >
            Daftar Akun Baru
          </h1>
          <p className="text-sm text-[#64748b] mb-6">
            Isi form di bawah untuk mendaftar
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {errors.general && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 leading-relaxed">
                {errors.general}
              </div>
            )}
            {/* Nama */}
            <div>
              <label
                className="block text-xs text-[#334155] mb-1.5"
                style={{ fontWeight: 600 }}
              >
                Nama Lengkap <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Nama sesuai KTP"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all ${
                  errors.name ? "border-red-300 bg-red-50" : "border-[#e2e8f0]"
                }`}
              />
              {errors.name && (
                <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  className="text-xs text-[#334155]"
                  style={{ fontWeight: 600 }}
                >
                  Email <span className="text-red-500">*</span>
                </label>
                {detectedRole && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full text-white flex items-center gap-1"
                    style={{
                      fontWeight: 600,
                      background:
                        detectedRole === "admin"
                          ? "linear-gradient(135deg,#7c3aed,#a78bfa)"
                          : "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
                    }}
                  >
                    {detectedRole === "admin" ? "Administrator" : "User"}
                  </span>
                )}
              </div>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="nama@sgn.com"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all ${
                  errors.email ? "border-red-300 bg-red-50" : "border-[#e2e8f0]"
                }`}
              />
              {errors.email ? (
                <p className="text-[11px] text-red-500 mt-1">{errors.email}</p>
              ) : (
                <p className="text-[10px] text-[#94a3b8] mt-1">
                  User: @sgn.com · Admin: @admin.sgn.com
                </p>
              )}
            </div>

            {/* NIK */}
            <div>
              <label
                className="block text-xs text-[#334155] mb-1.5"
                style={{ fontWeight: 600 }}
              >
                NIK Pegawai <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.nik}
                onChange={(e) => set("nik", e.target.value)}
                placeholder="Contoh: SGN-USR-001"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all ${
                  errors.nik ? "border-red-300 bg-red-50" : "border-[#e2e8f0]"
                }`}
              />
              {errors.nik && (
                <p className="text-[11px] text-red-500 mt-1">{errors.nik}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label
                className="block text-xs text-[#334155] mb-1.5"
                style={{ fontWeight: 600 }}
              >
                Kata Sandi <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="Min. 8 karakter"
                  className={`w-full px-4 py-2.5 pr-10 rounded-xl border text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all ${
                    errors.password
                      ? "border-red-300 bg-red-50"
                      : "border-[#e2e8f0]"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b]"
                >
                  {showPass ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {/* Strength bar */}
              {form.password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="flex-1 h-1 rounded-full transition-all"
                        style={{
                          background: i <= strength ? strengthColor : "#e2e8f0",
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-[10px]" style={{ color: strengthColor }}>
                    {strengthLabel}
                  </p>
                </div>
              )}
              {errors.password && (
                <p className="text-[11px] text-red-500 mt-1">
                  {errors.password}
                </p>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label
                className="block text-xs text-[#334155] mb-1.5"
                style={{ fontWeight: 600 }}
              >
                Konfirmasi Kata Sandi <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  value={form.confirm}
                  onChange={(e) => set("confirm", e.target.value)}
                  placeholder="Ulangi kata sandi"
                  className={`w-full px-4 py-2.5 pr-10 rounded-xl border text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all ${
                    errors.confirm
                      ? "border-red-300 bg-red-50"
                      : form.confirm && form.confirm === form.password
                        ? "border-[#10b981] bg-green-50"
                        : "border-[#e2e8f0]"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b]"
                >
                  {showConfirm ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
                {form.confirm && form.confirm === form.password && (
                  <svg
                    className="absolute right-8 top-1/2 -translate-y-1/2 w-4 h-4 text-[#10b981]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              {errors.confirm && (
                <p className="text-[11px] text-red-500 mt-1">
                  {errors.confirm}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-xl text-white text-sm mt-2 disabled:opacity-60"
              style={{
                fontWeight: 600,
                background:
                  "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
              }}
            >
              {submitting ? "Mendaftarkan..." : "Daftar Sekarang"}
            </button>

            <p className="text-center text-xs text-[#94a3b8]">
              Sudah punya akun?{" "}
              <button
                type="button"
                onClick={onBack}
                className="text-[#1e40af] hover:underline"
                style={{ fontWeight: 600 }}
              >
                Masuk di sini
              </button>
            </p>
          </form>
        </div>
      </div>

      {/* Right panel */}
      <div
        className="hidden lg:flex flex-col justify-center items-center flex-1 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
        }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative z-10 text-center px-12">
          <div className="w-20 h-20 bg-white/15 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h2 className="text-white text-2xl mb-3" style={{ fontWeight: 700 }}>
            Bergabung dengan SGN
          </h2>
          <p className="text-white/70 text-sm leading-relaxed max-w-xs mx-auto">
            Daftarkan akun Anda untuk mengakses AI Admin Assistant dan semua
            dokumen SOP perusahaan.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage({
  onLogin,
  onRegister,
}: {
  onLogin: (account: AccountRecord) => void
  onRegister: () => void
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectedRole = email.includes("@") ? detectRole(email) : null

  const validateDomain = (val: string) => {
    if (val && val.includes("@") && !detectRole(val)) {
      return `Gunakan email domain @sgn.com (user) atau @admin.sgn.com (admin)`
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const domainErr = validateDomain(email)
    if (domainErr) {
      setError(domainErr)
      return
    }

    setLoading(true)
    try {
      // no-cors + text/plain = simple request tanpa preflight
      console.log("[Login] Sending to:", N8N_LOGIN_URL)
      await fetch(N8N_LOGIN_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ email: email.toLowerCase(), password }),
      })
      // Response opaque, tidak bisa diverifikasi — bangun profil dari localStorage + domain
      let cached: { name?: string nik?: string role?: Role } = {}
      try {
        const store = JSON.parse(
          localStorage.getItem("sgn_profile_cache") ?? "{}",
        )
        cached = store[email.toLowerCase()] ?? {}
      } catch {}
      const account: AccountRecord = {
        email: email.toLowerCase(),
        password: "",
        role: cached.role ?? detectRole(email) ?? "user",
        name: cached.name ?? "",
        jabatan: "",
        departemen: "",
        nik: cached.nik ?? "",
      }
      console.log("[Login] Profile from cache:", account)
      onLogin(account)
    } catch (err) {
      console.error("[Login] Error:", err)
      setError(
        `Gagal terhubung ke server: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Form */}
      <div className="flex flex-col justify-center items-center w-full lg:w-[45%] px-6 sm:px-14 py-12 bg-white min-h-screen lg:min-h-0">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center mb-10">
            <img
              src={logoImg}
              alt="SGN"
              className="w-16 h-16 object-contain mb-2"
            />
            <div
              className="text-[#1e40af] text-lg leading-tight"
              style={{ fontWeight: 700 }}
            >
              PT SGN
            </div>
            <div className="text-[#94a3b8] text-xs">AI Admin Assistant</div>
          </div>

          <h1
            className="text-2xl text-[#1e40af] mb-1"
            style={{ fontWeight: 700 }}
          >
            Selamat Datang
          </h1>
          <p className="text-sm text-[#64748b] mb-6">
            Masuk menggunakan akun SGN Anda
          </p>

          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3">
              <svg
                className="w-4 h-4 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  className="text-xs text-[#334155]"
                  style={{ fontWeight: 600 }}
                >
                  Email
                </label>
                {detectedRole && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full text-white flex items-center gap-1"
                    style={{
                      fontWeight: 600,
                      background:
                        detectedRole === "admin"
                          ? "linear-gradient(135deg,#7c3aed,#a78bfa)"
                          : "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
                    }}
                  >
                    <svg
                      className="w-2.5 h-2.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {detectedRole === "admin" ? "Administrator" : "User"}
                  </span>
                )}
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
                onBlur={(e) => {
                  const err = validateDomain(e.target.value)
                  if (err) setError(err)
                }}
                placeholder="nama@sgn.com atau nama@admin.sgn.com"
                required
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all ${
                  error && error.includes("domain")
                    ? "border-red-300 bg-red-50"
                    : "border-[#e2e8f0]"
                }`}
              />
              <p className="text-[10px] text-[#94a3b8] mt-1.5">
                User: <span className="text-[#64748b]">@sgn.com</span> · Admin:{" "}
                <span className="text-[#64748b]">@admin.sgn.com</span>
              </p>
            </div>
            <div>
              <label
                className="block text-xs text-[#334155] mb-1.5"
                style={{ fontWeight: 600 }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-[#e2e8f0] text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b]"
                >
                  {showPass ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="flex justify-end"></div>
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs text-[#2563eb] hover:text-[#1e40af] transition-colors"
              >
                Lupa Password?
              </button>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#1e40af] text-white text-sm hover:bg-[#1d4ed8] active:scale-[0.98] transition-all disabled:opacity-70 flex items-center justify-center gap-2"
              style={{ fontWeight: 600 }}
            >
              {loading ? (
                <>
                  <svg
                    className="w-4 h-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8z"
                    />
                  </svg>
                  Memverifikasi...
                </>
              ) : (
                "Masuk"
              )}
            </button>
          </form>
          <p className="text-center text-xs text-[#94a3b8] mt-6">
            {"Belum punya akun? "}
            <button
              onClick={onRegister}
              className="text-[#1e40af] hover:underline"
              style={{ fontWeight: 600 }}
            >
              Daftar di sini
            </button>
          </p>
          <p className="text-center text-xs text-[#94a3b8] mt-2">
            Akses hanya untuk karyawan PT SGN yang terdaftar.
          </p>
        </div>
      </div>

      {/* Illustration */}
      <div
        className="hidden lg:flex flex-col justify-center items-center w-[55%] relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
        }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative z-10 w-80 space-y-3">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[#2563eb] flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-4 h-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <p className="text-white/90 text-xs leading-relaxed">
                Prosedur PO ada di{" "}
                <span className="text-[#60a5fa]">SOP SGN/PRO/001</span> Bab 3,
                hal. 12–15 dan dikuatkan oleh Perpres 16/2018 Pasal 38.
              </p>
            </div>
          </div>
          <div className="ml-auto w-56 bg-[#2563eb]/80 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
            <p className="text-white text-xs">Bagian pengadaan dimana?</p>
          </div>
          <div className="space-y-1.5">
            {["SGN", "Holding", "Perpres"].map((src, i) => (
              <div
                key={src}
                className="bg-white/8 backdrop-blur-sm rounded-xl p-2.5 border border-white/10 flex items-center gap-2.5"
                style={{ marginLeft: i * 8 }}
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 text-white text-[9px]"
                  style={{
                    fontWeight: 700,
                    backgroundColor: SOURCE_COLORS[src],
                  }}
                >
                  {src.slice(0, 2)}
                </div>
                <p className="text-white/80 text-[10px]">
                  {src === "SGN"
                    ? "Struktur Org. PT SGN — Divisi Pengadaan"
                    : src === "Holding"
                      ? "Pedoman Grup Holding — Wewenang Pengadaan"
                      : "Perpres 16/2018 — Unit Kerja Pengadaan"}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-10 text-center">
          <p className="text-white/40 text-xs">AI Admin Assistant · PT SGN</p>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({
  page,
  setPage,
  onLogout,
  open,
  onClose,
  role,
}: {
  page: Page
  setPage: (p: Page) => void
  onLogout: () => void
  open: boolean
  onClose: () => void
  role?: Role
}) {
  const navItems = [
    {
      key: "dashboard" as Page,
      label: "Dashboard",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ),
    },
    {
      key: "chat" as Page,
      label: "Chat AI",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      ),
      badge: "Baru",
    },
    {
      key: "history" as Page,
      label: "Riwayat Chat",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    ...(role === "admin"
      ? [
          {
            key: "sop" as Page,
            label: "Dokumen SOP",
            icon: (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
              >
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            badge: "Admin",
          },
        ]
      : []),
  ]

  const inner = (
    <aside
      className="w-60 flex flex-col h-full"
      style={{
        background:
          "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
      }}
    >
      {/* Brand */}
      <div className="px-5 py-5 border-b border-white/10">
        <SgnLogo size={34} withText />
      </div>

      {/* Decorative accent bar at top */}
      <div
        className="h-0.5 w-full"
        style={{
          background: "linear-gradient(90deg, #2563eb, #06b6d4, #7c3aed)",
        }}
      />

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              setPage(item.key)
              onClose()
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all ${
              page === item.key
                ? "text-white shadow-md"
                : "text-white/60 hover:bg-white/8 hover:text-white"
            }`}
            style={{
              fontWeight: page === item.key ? 600 : 400,
              background:
                page === item.key
                  ? "linear-gradient(135deg, rgba(37,99,235,0.55) 0%, rgba(6,182,212,0.25) 100%)"
                  : undefined,
            }}
          >
            <span
              className={page === item.key ? "text-[#60a5fa]" : "text-white/40"}
            >
              {item.icon}
            </span>
            {item.label}
            {item.badge && (
              <span
                className="ml-auto text-white text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  fontWeight: 600,
                  background: "linear-gradient(90deg,#2563eb,#06b6d4)",
                }}
              >
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/50 hover:bg-white/8 hover:text-white/80 transition-all"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
          >
            <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Keluar
        </button>
      </div>
    </aside>
  )

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block flex-shrink-0">{inner}</div>
      {/* Mobile overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <div className="relative">{inner}</div>
        </div>
      )}
    </>
  )
}

// ── Profile Panel (header dropdown) ──────────────────────────────────────────
function ProfilePanel({
  profile,
  setProfile,
  onLogout,
  onClose,
}: {
  profile: UserProfile
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>
  onLogout: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<UserProfile>({ ...profile })
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    profile.photoUrl ?? null,
  )
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const initials = profile.name
    ? profile.name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?"

  const handlePhoto = (file: File) => {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const url = e.target?.result as string
      setPhotoPreview(url)
      setDraft((prev) => ({ ...prev, photoUrl: url }))
    }
    reader.readAsDataURL(file)
  }

  const removePhoto = () => {
    setPhotoPreview(null)
    setDraft((prev) => ({ ...prev, photoUrl: undefined }))
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleSave = () => {
    // Preserve role and email from the real profile — never overwrite from draft
    setProfile((prev) => ({ ...draft, role: prev.role, email: prev.email }))
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleCancel = () => {
    setDraft({ ...profile, role: profile.role })
    setPhotoPreview(profile.photoUrl ?? null)
    setEditing(false)
  }

  const isAdmin = profile.role === "admin"

  // User hanya bisa edit Nama. Admin bisa edit semua kecuali Email.
  const fields: {
    key: keyof UserProfile
    label: string
    placeholder: string
    locked?: boolean
  }[] = [
    { key: "name", label: "Nama Lengkap", placeholder: "Masukkan nama" },
    { key: "email", label: "Email", placeholder: "nama@sgn.com", locked: true },
    { key: "jabatan", label: "Jabatan", placeholder: "Jabatan Anda" },
    { key: "departemen", label: "Departemen", placeholder: "Departemen Anda" },
    { key: "nik", label: "NIK / ID", placeholder: "ID Karyawan" },
  ]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div
        className="absolute right-0 top-14 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-[#e2e8f0] overflow-hidden"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
      >
        {/* Header gradient */}
        <div
          className="h-16 relative"
          style={{
            background:
              "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
          }}
        >
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center -mt-8 px-5 pb-4">
          <div className="relative group mb-3">
            <div
              className="w-16 h-16 rounded-2xl border-4 border-white shadow-lg overflow-hidden cursor-pointer"
              style={{
                background:
                  "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
              }}
              onClick={() => editing && fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                if (editing) setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                if (editing) {
                  const f = e.dataTransfer.files?.[0]
                  if (f) handlePhoto(f)
                }
              }}
            >
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="foto"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white text-xl"
                  style={{ fontWeight: 700 }}
                >
                  {initials}
                </div>
              )}
              {editing && (
                <div
                  className={`absolute inset-0 flex items-center justify-center transition-all ${
                    dragOver
                      ? "bg-black/60"
                      : "bg-black/0 group-hover:bg-black/50"
                  }`}
                >
                  <svg
                    className={`w-5 h-5 text-white transition-opacity ${
                      dragOver
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <circle cx="12" cy="13" r="3" />
                  </svg>
                </div>
              )}
            </div>
            {editing && photoPreview && (
              <button
                onClick={removePhoto}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 border-2 border-white flex items-center justify-center"
              >
                <svg
                  className="w-2.5 h-2.5 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  viewBox="0 0 24 24"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handlePhoto(f)
            }}
          />

          {editing ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="text-[11px] text-[#2563eb] hover:underline mb-1"
            >
              Ganti Foto
            </button>
          ) : (
            <>
              <p
                className="text-sm text-[#1e293b] text-center"
                style={{ fontWeight: 700 }}
              >
                {profile.name || "—"}
              </p>
              <p className="text-xs text-[#64748b] text-center">
                {[profile.jabatan, profile.departemen]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
              {profile.role && (
                <span
                  className="mt-1.5 text-[10px] px-2 py-0.5 rounded-full text-white"
                  style={{
                    fontWeight: 600,
                    background:
                      profile.role === "admin"
                        ? "linear-gradient(135deg,#7c3aed,#a78bfa)"
                        : "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
                  }}
                >
                  {profile.role === "admin" ? "Administrator" : "User"}
                </span>
              )}
            </>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-[#f1f5f9] mx-5" />

        {/* Fields */}
        <div className="px-5 py-4 space-y-3 max-h-64 overflow-y-auto">
          {saved && (
            <div className="flex items-center gap-2 text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <svg
                className="w-3.5 h-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Profil berhasil disimpan.
            </div>
          )}
          {fields.map((f) => (
            <div key={f.key}>
              <div className="flex items-center gap-1.5 mb-1">
                <p
                  className="text-[10px] text-[#94a3b8] uppercase tracking-wide"
                  style={{ fontWeight: 600 }}
                >
                  {f.label}
                </p>
              </div>
              {editing && !f.locked ? (
                <input
                  type="text"
                  value={draft[f.key] as string}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#e2e8f0] text-xs text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all"
                />
              ) : editing && f.locked ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#f8fafc] border border-[#e2e8f0]">
                  <span className="text-xs text-[#94a3b8] flex-1 truncate">
                    {draft[f.key] as string || "—"}
                  </span>
                  <svg
                    className="w-3 h-3 text-[#cbd5e1] shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
              ) : (
                <p className="text-xs text-[#334155] px-0.5">
                  {profile[f.key] as string || (
                    <span className="text-[#94a3b8] italic">
                      {f.placeholder}
                    </span>
                  )}
                </p>
              )}
            </div>
          ))}

          {/* Info hint for non-admin */}
          {editing && !isAdmin && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1">
              <svg
                className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-[10px] text-amber-700 leading-relaxed">
                Jabatan, Departemen, dan NIK hanya dapat diubah oleh
                Administrator.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-3 border-t border-[#f1f5f9] space-y-2">
          {editing ? (
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="flex-1 py-2 rounded-xl border border-[#e2e8f0] text-xs text-[#64748b] hover:bg-[#f8fafc] transition-colors"
                style={{ fontWeight: 500 }}
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2 rounded-xl text-white text-xs transition-colors flex items-center justify-center gap-1.5"
                style={{
                  fontWeight: 600,
                  background:
                    "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
                }}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Simpan
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-full py-2 rounded-xl border border-[#e2e8f0] text-xs text-[#334155] hover:bg-[#f8fafc] transition-colors flex items-center justify-center gap-2"
              style={{ fontWeight: 500 }}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit Profil
            </button>
          )}
          <button
            onClick={onLogout}
            className="w-full py-2 rounded-xl border border-[#fee2e2] bg-[#fff5f5] text-[#ef4444] text-xs hover:bg-[#fee2e2] transition-colors flex items-center justify-center gap-2"
            style={{ fontWeight: 500 }}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Keluar dari Akun
          </button>
        </div>
      </div>
    </>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({
  title,
  subtitle,
  onMenuOpen,
  profile,
  setProfile,
  onLogout,
}: {
  title: string
  subtitle?: string
  onMenuOpen: () => void
  profile: UserProfile
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>
  onLogout: () => void
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const initials = profile.name
    ? profile.name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?"

  return (
    <header
      className="h-14 border-b border-[#e2e8f0] flex items-center justify-between px-4 sm:px-6 flex-shrink-0 relative"
      style={{
        background:
          "linear-gradient(90deg, #ffffff 0%, #f0f6ff 60%, #e8f4fb 100%)",
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuOpen}
          className="lg:hidden p-2 rounded-lg text-[#64748b] hover:bg-[#f1f5f9] transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div>
          <h2 className="text-sm text-[#1e293b]" style={{ fontWeight: 600 }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-[#64748b] hidden sm:block">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* Clickable profile chip */}
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="flex items-center gap-2 pl-3 border-l border-[#e2e8f0] hover:opacity-80 transition-opacity"
        >
          <div
            className="w-8 h-8 rounded-full overflow-hidden border-2 border-white shadow-sm flex items-center justify-center text-white text-xs"
            style={{
              fontWeight: 600,
              background:
                "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
            }}
          >
            {profile.photoUrl ? (
              <img
                src={profile.photoUrl}
                alt="avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
          <div className="hidden sm:block text-left">
            <div className="flex items-center gap-1.5">
              <span
                className="text-xs text-[#1e293b]"
                style={{ fontWeight: 500 }}
              >
                {profile.name || "User"}
              </span>
              {profile.role && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full text-white"
                  style={{
                    fontWeight: 600,
                    background:
                      profile.role === "admin"
                        ? "linear-gradient(135deg,#7c3aed,#a78bfa)"
                        : "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
                  }}
                >
                  {profile.role === "admin" ? "Admin" : "User"}
                </span>
              )}
            </div>
            <div className="text-[10px] text-[#94a3b8]">
              {profile.departemen || "—"}
            </div>
          </div>
          <svg
            className="w-3 h-3 text-[#94a3b8] hidden sm:block"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Profile panel dropdown */}
      {panelOpen && (
        <ProfilePanel
          profile={profile}
          setProfile={setProfile}
          onLogout={onLogout}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </header>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardPage({
  setPage,
  weeklyCount,
  sessions,
}: {
  setPage: (p: Page) => void
  weeklyCount: number
  sessions: ChatSession[]
}) {
  const docCategories = [
    { label: "SGN", count: 48, color: "#1e40af" },
    { label: "Holding", count: 31, color: "#7c3aed" },
    { label: "Perpres", count: 22, color: "#0369a1" },
    { label: "Permen", count: 19, color: "#0f766e" },
  ]
  const totalDocs = docCategories.reduce((s, d) => s + d.count, 0)

  const topics = [
    { topic: "Prosedur Purchase Order", count: 31, category: "Pengadaan" },
    {
      topic: "Manajemen & Kualifikasi Vendor",
      count: 24,
      category: "Pengadaan",
    },
    { topic: "Pengadaan Aset & Barang IT", count: 19, category: "Pengadaan" },
    { topic: "SOP e-Procurement SGN", count: 15, category: "Pengadaan" },
  ]

  return (
    <div
      className="flex-1 overflow-auto p-4 sm:p-6"
      style={{
        background:
          "linear-gradient(160deg, #f0f6ff 0%, #f8fafc 40%, #f0fbff 100%)",
      }}
    >
      {/* Welcome banner */}
      <div
        className="rounded-2xl p-5 sm:p-6 mb-5 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
        }}
      >
        <div
          className="absolute right-0 top-0 bottom-0 w-40 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div
          className="absolute -right-8 -bottom-8 w-40 h-40 rounded-full opacity-10"
          style={{
            background: "radial-gradient(circle, #06b6d4, transparent 70%)",
          }}
        />
        <p className="text-white/60 text-xs mb-0.5">Senin, 10 Agustus 2026</p>
        <h1
          className="text-white text-lg sm:text-xl mb-1"
          style={{ fontWeight: 700 }}
        >
          Selamat pagi! 👋
        </h1>
        <p className="text-white/70 text-sm mb-4">
          Tanyakan prosedur SOP pengadaan, vendor, atau kebijakan perusahaan
          secara instan.
        </p>
        <button
          onClick={() => setPage("chat")}
          className="bg-white text-[#1e40af] text-sm px-5 py-2 rounded-lg hover:bg-white/90 transition-colors flex items-center gap-2"
          style={{ fontWeight: 600 }}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          Mulai Chat Baru
        </button>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent */}
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm text-[#1e293b]" style={{ fontWeight: 600 }}>
              Riwayat Terbaru
            </h3>
            <button
              onClick={() => setPage("history")}
              className="text-xs text-[#2563eb] hover:text-[#1e40af] transition-colors"
            >
              Lihat Semua
            </button>
          </div>
          <div className="space-y-2">
            {sessions.slice(0, 4).map((s) => (
              <button
                key={s.id}
                onClick={() => setPage("chat")}
                className="w-full flex items-start gap-3 p-2.5 rounded-lg hover:bg-[#f8fafc] transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-lg bg-[#e8f0fe] flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-3.5 h-3.5 text-[#2563eb]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-xs text-[#334155] truncate"
                    style={{ fontWeight: 500 }}
                  >
                    {s.title}
                  </p>
                  <p className="text-[10px] text-[#94a3b8]">
                    {formatDate(s.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Topics */}
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm text-[#1e293b]" style={{ fontWeight: 600 }}>
              Topik SOP Populer
            </h3>
            <span className="text-[10px] text-[#94a3b8] bg-[#f1f5f9] px-2 py-0.5 rounded-full">
              Bulan ini
            </span>
          </div>
          <div className="space-y-3">
            {topics.map((t, i) => (
              <div key={t.topic} className="flex items-center gap-3">
                <span className="text-xs text-[#94a3b8] w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[#334155] truncate">
                      {t.topic}
                    </span>
                    <span className="text-[10px] text-[#94a3b8] shrink-0 ml-2">
                      {t.count}x
                    </span>
                  </div>
                  <div className="h-1 bg-[#f1f5f9] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#1e40af] rounded-full"
                      style={{ width: `${(t.count / 31) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-[9px] text-[#64748b] bg-[#f1f5f9] px-1.5 py-0.5 rounded shrink-0">
                  {t.category}
                </span>
              </div>
            ))}
          </div>

          {/* Doc category breakdown */}
          <div className="mt-4 pt-4 border-t border-[#f1f5f9]">
            <p
              className="text-[10px] text-[#94a3b8] mb-2.5"
              style={{ fontWeight: 600 }}
            >
              DOKUMEN PER KATEGORI
            </p>
            <div className="flex gap-2 flex-wrap">
              {docCategories.map((d) => (
                <div
                  key={d.label}
                  className="flex items-center gap-1.5 text-[10px] text-[#334155]"
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: d.color }}
                  />
                  <span>{d.label}</span>
                  <span className="text-[#94a3b8]">({d.count})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SOP Reference Card ────────────────────────────────────────────────────────
function SopRefCard({ refs }: { refs: SopRef[] }) {
  return (
    <div className="mt-2 border border-[#e2e8f0] rounded-xl overflow-hidden bg-white w-full">
      <div className="px-3 sm:px-4 py-2 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center gap-2">
        <svg
          className="w-3.5 h-3.5 text-[#64748b] shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span
          className="text-[10px] text-[#64748b] uppercase tracking-wide"
          style={{ fontWeight: 600 }}
        >
          Referensi Dokumen ({refs.length} sumber)
        </span>
      </div>
      <div className="divide-y divide-[#f1f5f9]">
        {refs.map((ref, i) => (
          <div key={i} className="px-3 sm:px-4 py-2.5 sm:py-3">
            {/* Top row: PDF icon + title + Lihat button */}
            <div className="flex items-start gap-2.5">
              {/* PDF icon */}
              <div className="w-8 h-9 sm:w-9 sm:h-10 flex-shrink-0">
                <svg viewBox="0 0 36 40" className="w-full h-full" fill="none">
                  <path
                    d="M4 0h20l12 12v24a4 4 0 01-4 4H4a4 4 0 01-4-4V4a4 4 0 014-4z"
                    fill="#fff"
                    stroke="#e2e8f0"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M24 0l12 12H28a4 4 0 01-4-4V0z"
                    fill="#f1f5f9"
                    stroke="#e2e8f0"
                    strokeWidth="1.5"
                  />
                  <rect
                    x="6"
                    y="18"
                    width="24"
                    height="14"
                    rx="2"
                    fill="#dc2626"
                  />
                  <text
                    x="18"
                    y="28.5"
                    textAnchor="middle"
                    fill="white"
                    fontSize="6.5"
                    fontFamily="Inter,sans-serif"
                    fontWeight="700"
                  >
                    PDF
                  </text>
                </svg>
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-[11px] sm:text-xs text-[#1e293b] leading-snug"
                  style={{ fontWeight: 600 }}
                >
                  {ref.title}
                </p>
                <p className="text-[10px] text-[#64748b] mt-0.5 leading-snug">
                  {ref.chapter}
                </p>
                <p className="text-[10px] text-[#94a3b8]">{ref.pages}</p>
                <span
                  className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded text-white"
                  style={{ backgroundColor: ref.color, fontWeight: 700 }}
                >
                  {ref.badge}
                </span>
              </div>

              {/* Lihat button — icon-only on xs, with text on sm+ */}
              <button
                className="flex-shrink-0 text-[#2563eb] border border-[#2563eb]/30 rounded-lg hover:bg-[#e8f0fe] transition-colors flex items-center gap-1 px-2 py-1.5 sm:px-2.5 sm:text-xs mt-0.5"
                style={{ fontWeight: 500 }}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className="hidden sm:inline text-xs">Lihat</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function ChatPage({
  userId,
  sessions,
  setSessions,
  onWeeklyCount,
  openSessionId,
  onClearOpenSession,
}: {
  userId: string
  sessions: ChatSession[]
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>
  onWeeklyCount: () => void
  openSessionId: string | null
  onClearOpenSession: () => void
}) {
  const [activeId, setActiveId] = useState<string | null>(openSessionId)
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    console.log("[ChatPage] VITE_CHAT_URL =", N8N_CHAT_URL)
  }, [])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (!input) {
      el.style.height = "24px"
      el.scrollTop = 0
      return
    }
    el.style.height = "0px"
    console.log("[Chat textarea] scrollHeight:", el.scrollHeight)
    el.style.height = el.scrollHeight + "px"
  }, [input])

  const activeSession = sessions.find((s) => s.id === activeId) ?? null

  // When navigating from history, open that session
  useEffect(() => {
    if (openSessionId) {
      setActiveId(openSessionId)
      onClearOpenSession()
    }
  }, [openSessionId, onClearOpenSession])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [activeSession?.messages, isTyping])

  const startNew = useCallback(() => {
    // sessionId unik & terikat ke akun yang login (bukan sekadar random per-tab).
    const unique =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const id = `session-${userId || "anon"}-${unique}`
    const newSession: ChatSession = {
      id,
      title: "Percakapan Baru",
      updatedAt: new Date(),
      messages: [
        {
          id: 1,
          role: "ai",
          text: 'Halo! Saya AI Admin Assistant PT SGN. Tanyakan apa saja tentang SOP Pengadaan, Vendor, Keuangan, atau kebijakan perusahaan. Contoh: "Bagaimana cara membuat PO?" atau "Bagian pengadaan dimana?"',
          timestamp: new Date(),
          feedback: null,
        },
      ],
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveId(id)
  }, [setSessions, userId])

  const sendMessage = () => {
    if (!input.trim() || isTyping) return
    const text = input.trim()

    if (!activeId) {
      startNew()
      return
    }

    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      text,
      timestamp: new Date(),
      feedback: null,
    }

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              title:
                s.title === "Percakapan Baru" ? text.slice(0, 50) : s.title,
              messages: [...s.messages, userMsg],
              updatedAt: new Date(),
            }
          : s,
      ),
    )
    setInput("")
    setIsTyping(true)
    onWeeklyCount()

    const sessionId = activeId
    ;(async () => {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 120_000)
      try {
        const payload = {
          action: "sendMessage",
          chatInput: text,
          sessionId,
        }
        console.log("=== [Chat] DEBUG ===")
        console.log("[Chat] URL:", N8N_CHAT_URL)
        console.log(
          "[Chat] import.meta.env.VITE_CHAT_URL:",
          import.meta.env.VITE_CHAT_URL,
        )
        console.log("[Chat] Payload:", JSON.stringify(payload))
        const res = await fetch(N8N_CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        console.log("[Chat] Response status:", res.status)
        const rawText = await res.text()
        console.log("[Chat] Response body:", rawText)
        if (!res.ok) throw new Error(`Server error ${res.status}: ${rawText}`)
        let data: Record<string, unknown> = {}
        try {
          data = JSON.parse(rawText)
        } catch {
          data = { output: rawText }
        }
        const aiText: string =
          data.output as string ??
          data.text as string ??
          data.message as string ??
          data.response as string ??
          (rawText.trim() || "Maaf, tidak ada respons dari server.")
        const referencedFiles = parseReferencedFiles(data)
        const aiMsg: Message = {
          id: Date.now() + 1,
          role: "ai",
          text: aiText,
          referencedFiles:
            referencedFiles.length > 0 ? referencedFiles : undefined,
          timestamp: new Date(),
          feedback: null,
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: [...s.messages, aiMsg],
                  updatedAt: new Date(),
                }
              : s,
          ),
        )
      } catch {
        const aiMsg: Message = {
          id: Date.now() + 1,
          role: "ai",
          text: "Maaf, layanan AI sedang mengalami gangguan. Silakan coba lagi beberapa saat.",
          timestamp: new Date(),
          feedback: null,
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: [...s.messages, aiMsg],
                  updatedAt: new Date(),
                }
              : s,
          ),
        )
      } finally {
        window.clearTimeout(timeoutId)
        setIsTyping(false)
      }
    })()
  }

  const setFeedback = (
    msgId: number,
    feedback: "satisfied" | "unsatisfied",
  ) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === msgId ? { ...m, feedback } : m,
              ),
            }
          : s,
      ),
    )
  }

  const suggestions = [
    "Bagaimana cara membuat PO?",
    "Bagian pengadaan dimana?",
    "Prosedur kualifikasi vendor?",
    "Cara klaim lembur?",
  ]

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Session sidebar — hidden, history accessible via Riwayat Chat menu */}
      <div className="hidden flex-col w-60 shrink-0 border-r border-[#e2e8f0] bg-white overflow-hidden">
        <div className="px-3 py-3 border-b border-[#e2e8f0] flex items-center justify-between">
          <span className="text-xs text-[#1e293b]" style={{ fontWeight: 600 }}>
            Riwayat Chat
          </span>
          <button
            onClick={startNew}
            className="w-7 h-7 rounded-lg bg-[#1e40af] flex items-center justify-center text-white hover:bg-[#1d4ed8] transition-colors"
            title="Chat Baru"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-[#94a3b8]">Belum ada percakapan</p>
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveId(s.id)
              }}
              className={`w-full text-left px-3 py-2.5 transition-colors ${
                activeId === s.id ? "bg-[#e8f0fe]" : "hover:bg-[#f8fafc]"
              }`}
            >
              <p
                className={`text-xs truncate ${
                  activeId === s.id ? "text-[#1e40af]" : "text-[#334155]"
                }`}
                style={{ fontWeight: activeId === s.id ? 600 : 400 }}
              >
                {s.title}
              </p>
              <p className="text-[10px] text-[#94a3b8] mt-0.5">
                {formatDate(s.updatedAt)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Main chat */}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, #f0f6ff 0%, #f8fafc 50%, #f0fbff 100%)",
        }}
      >
        {/* Sub-header */}
        <div className="bg-white border-b border-[#e2e8f0] px-4 py-2.5 flex items-center gap-3">
          <p
            className="text-xs text-[#334155] flex-1 truncate"
            style={{ fontWeight: 500 }}
          >
            {activeSession ? activeSession.title : "Mulai percakapan baru"}
          </p>
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 text-xs text-[#1e40af] border border-[#1e40af]/20 px-3 py-1.5 rounded-lg hover:bg-[#e8f0fe] transition-colors"
            style={{ fontWeight: 500 }}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="hidden sm:inline">Chat Baru</span>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto chat-area px-3 sm:px-5 py-4 sm:py-5 space-y-4 sm:space-y-5">
          {!activeSession ? (
            <div className="flex flex-col items-center justify-center h-full gap-5 px-2">
              <div className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center">
                <img
                  src={logoImg}
                  alt="SGN"
                  className="w-9 h-9 sm:w-10 sm:h-10 object-contain"
                />
              </div>
              <div className="text-center">
                <h3
                  className="text-sm sm:text-base text-[#1e293b] mb-1"
                  style={{ fontWeight: 600 }}
                >
                  AI Admin Assistant PT SGN
                </h3>
                <p className="text-xs sm:text-sm text-[#64748b]">
                  Tanyakan SOP, prosedur, atau kebijakan perusahaan
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      startNew()
                      setTimeout(() => setInput(s), 100)
                    }}
                    className="text-left text-xs text-[#334155] border border-[#e2e8f0] bg-white px-3 py-2.5 sm:px-3.5 sm:py-3 rounded-xl hover:border-[#1e40af]/30 hover:bg-[#f0f4ff] transition-all"
                  >
                    <span className="text-[#1e40af] mr-1.5">→</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {activeSession.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {/* Outer wrapper caps total width; avatar + gap are factored in */}
                  <div
                    className={`flex gap-2 min-w-0 ${
                      msg.role === "user" ? "flex-row-reverse" : ""
                    }`}
                    style={{ maxWidth: "min(92%, 560px)" }}
                  >
                    {/* AI avatar */}
                    {msg.role === "ai" && (
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-[#e2e8f0] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <img
                          src={logoImg}
                          alt="AI"
                          className="w-4 h-4 sm:w-5 sm:h-5 object-contain"
                        />
                      </div>
                    )}

                    {/* Content column */}
                    <div className="flex-1 min-w-0">
                      {/* Bubble */}
                      <div
                        className={`px-3 py-2.5 sm:px-4 sm:py-3 rounded-2xl text-[13px] sm:text-sm leading-relaxed break-words ${
                          msg.role === "user"
                            ? "text-white rounded-tr-sm"
                            : "bg-white border border-[#e2e8f0] text-[#1e293b] rounded-tl-sm"
                        }`}
                        style={
                          msg.role === "user"
                            ? {
                                background:
                                  "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
                              }
                            : undefined
                        }
                      >
                        {renderMessageMarkdown(
                          msg.text,
                          `underline underline-offset-2 break-all ${
                            msg.role === "user"
                              ? "text-white"
                              : "text-[#1e40af]"
                          }`,
                        )}
                      </div>
                      <p className="text-[10px] text-[#94a3b8] mt-1 px-0.5">
                        {formatTime(msg.timestamp)}
                      </p>

                      {msg.sopRefs && msg.sopRefs.length > 0 && (
                        <SopRefCard refs={msg.sopRefs} />
                      )}

                      {msg.referencedFiles &&
                        msg.referencedFiles.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {msg.referencedFiles.map((file, i) => (
                              <a
                                key={i}
                                href={file.url}
                                download={file.name}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-[11px] sm:text-xs text-[#1e40af] border border-[#2563eb]/30 bg-[#e8f0fe] px-3 py-2 rounded-xl hover:bg-[#dbeafe] transition-colors w-fit max-w-full"
                                style={{ fontWeight: 600 }}
                                title={`Download ${file.name}`}
                              >
                                <svg
                                  className="w-3.5 h-3.5 shrink-0"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                  <polyline points="7 10 12 15 17 10" />
                                  <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                <span className="truncate">
                                  Download {file.name}
                                </span>
                              </a>
                            ))}
                          </div>
                        )}

                      {msg.role === "ai" &&
                        msg.id !== activeSession.messages[0].id && (
                          <div className="mt-2 flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <button
                              onClick={() => {
                                const blob = new Blob([msg.text], {
                                  type: "text/plain;charset=utf-8",
                                })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement("a")
                                a.href = url
                                a.download = `SGN-AI-${new Date(msg.timestamp).toISOString().slice(0, 10)}.txt`
                                a.click()
                                URL.revokeObjectURL(url)
                              }}
                              className="flex items-center gap-1 text-[10px] text-[#64748b] border border-[#e2e8f0] px-2 py-1 sm:px-2.5 rounded-full hover:bg-[#f8fafc] transition-colors"
                              title="Unduh jawaban"
                            >
                              <svg
                                className="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                viewBox="0 0 24 24"
                              >
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              Unduh
                            </button>
                            {msg.feedback === null ? (
                              <>
                                <span className="text-[10px] text-[#94a3b8] w-full sm:w-auto">
                                  Apakah jawaban ini membantu?
                                </span>
                                <button
                                  onClick={() =>
                                    setFeedback(msg.id, "satisfied")
                                  }
                                  className="flex items-center gap-1 text-[10px] text-[#10b981] border border-[#10b981]/30 px-2 py-1 sm:px-2.5 rounded-full hover:bg-green-50 transition-colors"
                                >
                                  <svg
                                    className="w-3 h-3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                                  </svg>
                                  Puas
                                </button>
                                <button
                                  onClick={() =>
                                    setFeedback(msg.id, "unsatisfied")
                                  }
                                  className="flex items-center gap-1 text-[10px] text-[#ef4444] border border-[#ef4444]/30 px-2 py-1 sm:px-2.5 rounded-full hover:bg-red-50 transition-colors"
                                >
                                  <svg
                                    className="w-3 h-3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                                  </svg>
                                  <span className="hidden xs:inline">
                                    Tidak Puas
                                  </span>
                                  <span className="xs:hidden">Tidak Puas</span>
                                </button>
                              </>
                            ) : (
                              <span
                                className={`text-[10px] flex items-center gap-1 ${
                                  msg.feedback === "satisfied"
                                    ? "text-[#10b981]"
                                    : "text-[#64748b]"
                                }`}
                              >
                                {msg.feedback === "satisfied" ? (
                                  <>
                                    <svg
                                      className="w-3 h-3 shrink-0"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                      viewBox="0 0 24 24"
                                    >
                                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Terima kasih atas feedback Anda!
                                  </>
                                ) : (
                                  <>
                                    <svg
                                      className="w-3 h-3 shrink-0"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                      viewBox="0 0 24 24"
                                    >
                                      <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                    </svg>
                                    Coba ajukan pertanyaan dengan cara berbeda.
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="flex gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-[#1e40af] flex items-center justify-center flex-shrink-0">
                      <img
                        src={logoImg}
                        alt="AI"
                        className="w-5 h-5 object-contain"
                      />
                    </div>
                    <div className="bg-white border border-[#e2e8f0] px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
                      <span className="text-[10px] text-[#94a3b8] mr-1">
                        AI sedang mengetik
                      </span>
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-[#94a3b8] animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div
          className="bg-white px-3 sm:px-5 py-3 lg:py-3.5"
          style={{
            boxShadow: "0 -1px 0 #e2e8f0, 0 -4px 16px rgba(0,0,0,0.04)",
          }}
        >
          <div className="flex items-end gap-2">
            {/* Textarea box */}
            <div className="min-w-0 w-[calc(100%-3rem)] sm:w-[calc(100%-3.25rem)] self-end bg-white border-2 border-[#e2e8f0] rounded-2xl px-3 py-2 sm:px-4 focus-within:border-[#1e40af] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] transition-[border-color,box-shadow] overflow-hidden">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Ketik pertanyaan Anda..."
                rows={1}
                className="w-full h-6 min-h-6 max-h-28 bg-transparent text-[13px] sm:text-sm text-[#1e293b] placeholder-[#94a3b8] resize-none outline-none leading-relaxed block overflow-y-auto transition-[height] duration-100 ease-out [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              />
            </div>

            {/* Send button */}
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isTyping}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#1e40af] text-white flex items-center justify-center hover:bg-[#1d4ed8] active:scale-95 transition-all disabled:opacity-40 flex-shrink-0 self-end"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── History ───────────────────────────────────────────────────────────────────
function HistoryPage({
  sessions,
  setSessions,
  setPage,
  setActiveChat,
}: {
  sessions: ChatSession[]
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>
  setPage: (p: Page) => void
  setActiveChat: (id: string) => void
}) {
  const [search, setSearch] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Only show sessions that have at least one user message
  const withMessages = sessions.filter((s) =>
    s.messages.some((m) => m.role === "user"),
  )

  const filtered = withMessages.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.messages.some((m) =>
        m.text.toLowerCase().includes(search.toLowerCase()),
      ),
  )

  const handleDelete = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    setConfirmDelete(null)
  }

  const grouped: Record<string, ChatSession[]> = {}
  filtered.forEach((s) => {
    const key = formatDate(s.updatedAt)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(s)
  })

  return (
    <div
      className="flex-1 overflow-auto p-4 sm:p-6"
      style={{
        background:
          "linear-gradient(160deg, #f0f6ff 0%, #f8fafc 40%, #f0fbff 100%)",
      }}
    >
      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari riwayat percakapan..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#e2e8f0] rounded-xl text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/15 focus:border-[#1e40af] transition-all"
        />
      </div>

      {Object.entries(grouped).length === 0 && (
        <div className="text-center py-16">
          <div className="w-12 h-12 bg-[#f1f5f9] rounded-full flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-6 h-6 text-[#94a3b8]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </div>
          <p
            className="text-sm text-[#334155] mb-1"
            style={{ fontWeight: 500 }}
          >
            Tidak ada hasil
          </p>
          <p className="text-xs text-[#94a3b8]">Coba kata kunci yang berbeda</p>
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([date, list]) => (
          <div key={date}>
            <p
              className="text-[10px] text-[#94a3b8] mb-2 px-1 uppercase tracking-wide"
              style={{ fontWeight: 600 }}
            >
              {date}
            </p>
            <div className="space-y-2">
              {list.map((s) => {
                const lastMsg = s.messages[s.messages.length - 1]
                return (
                  <div key={s.id} className="relative">
                    {confirmDelete === s.id && (
                      <div className="absolute inset-0 z-10 bg-white border border-red-200 rounded-xl flex items-center justify-between px-4 gap-3">
                        <p
                          className="text-xs text-[#334155]"
                          style={{ fontWeight: 500 }}
                        >
                          Hapus percakapan ini?
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-[#64748b] border border-[#e2e8f0] px-3 py-1.5 rounded-lg hover:bg-[#f8fafc] transition-colors"
                          >
                            Batal
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 transition-colors"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    )}
                    <div
                      onClick={() => {
                        setActiveChat(s.id)
                        setPage("chat")
                      }}
                      className="w-full bg-white border border-[#e2e8f0] rounded-xl p-4 text-left hover:border-[#1e40af]/30 hover:shadow-sm transition-all group cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-[#e8f0fe] flex items-center justify-center flex-shrink-0">
                          <svg
                            className="w-4 h-4 text-[#2563eb]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.8}
                            viewBox="0 0 24 24"
                          >
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm text-[#1e293b] group-hover:text-[#1e40af] transition-colors truncate"
                            style={{ fontWeight: 500 }}
                          >
                            {s.title}
                          </p>
                          <p className="text-xs text-[#64748b] mt-0.5 line-clamp-1">
                            {lastMsg?.text.slice(0, 80)}...
                          </p>
                          <p className="text-[10px] text-[#94a3b8] mt-1">
                            {s.messages.length} pesan ·{" "}
                            {formatTime(s.updatedAt)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDelete(s.id)
                          }}
                          className="p-1.5 rounded-lg text-[#cbd5e1] hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0 mt-0.5"
                          title="Hapus percakapan"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfilePage({
  profile,
  setProfile,
  onLogout,
}: {
  profile: UserProfile
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>
  onLogout: () => void
}) {
  const [draft, setDraft] = useState<UserProfile>({ ...profile })
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  // Keep draft email in sync whenever login email changes
  useEffect(() => {
    setDraft((prev) => ({ ...prev, email: profile.email }))
  }, [profile.email])
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    profile.photoUrl ?? null,
  )
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fields: {
    key: keyof UserProfile
    label: string
    placeholder: string
    type?: string
    required?: boolean
  }[] = [
    {
      key: "name",
      label: "Nama Lengkap",
      placeholder: "Masukkan nama lengkap Anda",
      required: true,
    },
    {
      key: "email",
      label: "Email",
      placeholder: "username@gmail.com",
      type: "email",
      required: true,
    },
    {
      key: "jabatan",
      label: "Jabatan",
      placeholder: "Masukkan jabatan Anda",
      required: true,
    },
    {
      key: "departemen",
      label: "Departemen",
      placeholder: "Masukkan departemen Anda",
      required: true,
    },
    {
      key: "nik",
      label: "NIK / ID Karyawan",
      placeholder: "Masukkan NIK/ID karyawan",
    },
    { key: "perusahaan", label: "Perusahaan", placeholder: "PT SGN" },
  ]

  const handlePhoto = (file: File) => {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const url = e.target?.result as string
      setPhotoPreview(url)
      setDraft((prev) => ({ ...prev, photoUrl: url }))
    }
    reader.readAsDataURL(file)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handlePhoto(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handlePhoto(file)
  }

  const removePhoto = () => {
    setPhotoPreview(null)
    setDraft((prev) => ({ ...prev, photoUrl: undefined }))
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const requiredKeys: keyof UserProfile[] = [
    "name",
    "email",
    "jabatan",
    "departemen",
  ]
  const missingRequired = requiredKeys.filter(
    (k) => !(draft[k] as string)?.trim(),
  )

  const handleSave = () => {
    if (missingRequired.length > 0) return
    setProfile((prev) => ({ ...draft, role: prev.role, email: prev.email }))
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleCancel = () => {
    setDraft(profile)
    setPhotoPreview(profile.photoUrl ?? null)
    setEditing(false)
  }

  const initials = profile.name
    ? profile.name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?"

  return (
    <div
      className="flex-1 overflow-auto p-4 sm:p-6"
      style={{
        background:
          "linear-gradient(160deg, #f0f6ff 0%, #f8fafc 40%, #f0fbff 100%)",
      }}
    >
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Profile card */}
        <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
          <div
            className="h-20"
            style={{
              background:
                "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
            }}
          />
          <div className="px-5 sm:px-6 pb-5 sm:pb-6 -mt-9">
            <div className="flex items-end justify-between mb-4">
              {/* Avatar with upload overlay */}
              <div className="relative group">
                <div
                  className="w-16 h-16 sm:w-[68px] sm:h-[68px] rounded-2xl border-4 border-white shadow-md overflow-hidden cursor-pointer"
                  style={{ backgroundColor: "#1e40af" }}
                  onClick={() => editing && fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (editing) setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    if (editing) handleDrop(e)
                  }}
                >
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Foto profil"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-white text-xl"
                      style={{ fontWeight: 700 }}
                    >
                      {initials}
                    </div>
                  )}

                  {/* Hover overlay when editing */}
                  {editing && (
                    <div
                      className={`absolute inset-0 flex flex-col items-center justify-center transition-all rounded-xl ${
                        dragOver
                          ? "bg-black/60"
                          : "bg-black/0 group-hover:bg-black/50"
                      }`}
                    >
                      <svg
                        className={`w-5 h-5 text-white transition-opacity ${
                          dragOver
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <circle cx="12" cy="13" r="3" />
                      </svg>
                      <span
                        className={`text-[9px] text-white mt-0.5 transition-opacity ${
                          dragOver
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        Ganti
                      </span>
                    </div>
                  )}
                </div>

                {/* Remove button */}
                {editing && photoPreview && (
                  <button
                    onClick={removePhoto}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#ef4444] border-2 border-white flex items-center justify-center shadow-sm hover:bg-red-600 transition-colors"
                    title="Hapus foto"
                  >
                    <svg
                      className="w-2.5 h-2.5 text-white"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      viewBox="0 0 24 24"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Edit / Save buttons */}
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={handleCancel}
                      className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-[#e2e8f0] text-xs text-[#64748b] hover:bg-[#f8fafc] transition-colors"
                      style={{ fontWeight: 500 }}
                    >
                      Batal
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={missingRequired.length > 0}
                      className="px-3 sm:px-3.5 py-1.5 rounded-lg bg-[#1e40af] text-white text-xs hover:bg-[#1d4ed8] transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ fontWeight: 600 }}
                      title={
                        missingRequired.length > 0
                          ? "Lengkapi field wajib terlebih dahulu"
                          : ""
                      }
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Simpan
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-[#e2e8f0] text-xs text-[#334155] hover:bg-[#f8fafc] transition-colors flex items-center gap-1.5"
                    style={{ fontWeight: 500 }}
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit Profil
                  </button>
                )}
              </div>
            </div>

            <h2
              className="text-base sm:text-lg text-[#1e293b]"
              style={{ fontWeight: 700 }}
            >
              {profile.name || (
                <span className="text-[#94a3b8] italic text-sm">
                  Belum diisi
                </span>
              )}
            </h2>
            <p className="text-sm text-[#64748b]">
              {[profile.jabatan, profile.departemen]
                .filter(Boolean)
                .join(" · ") || (
                <span className="italic text-xs">
                  Tambahkan jabatan di Edit Profil
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Photo upload area — shown when editing */}
        {editing && (
          <div
            className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer ${
              dragOver
                ? "border-[#1e40af] bg-[#e8f0fe]"
                : "border-[#cbd5e1] bg-white hover:border-[#1e40af]/40 hover:bg-[#f8fafc]"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="w-10 h-10 rounded-xl bg-[#e8f0fe] flex items-center justify-center mx-auto mb-3">
              <svg
                className="w-5 h-5 text-[#1e40af]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
              >
                <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </div>
            <p
              className="text-sm text-[#334155] mb-0.5"
              style={{ fontWeight: 500 }}
            >
              {photoPreview ? "Ganti foto profil" : "Upload foto profil"}
            </p>
            <p className="text-xs text-[#94a3b8]">
              Klik atau seret foto ke sini · JPG, PNG, WebP maks. 5 MB
            </p>
            {photoPreview && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <div className="w-8 h-8 rounded-lg overflow-hidden border border-[#e2e8f0]">
                  <img
                    src={photoPreview}
                    alt="preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span
                  className="text-[11px] text-[#10b981]"
                  style={{ fontWeight: 500 }}
                >
                  Foto terpilih ✓
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removePhoto()
                  }}
                  className="text-[11px] text-[#ef4444] hover:underline"
                >
                  Hapus
                </button>
              </div>
            )}
          </div>
        )}

        {saved && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-green-700">
            <svg
              className="w-4 h-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Profil berhasil disimpan.
          </div>
        )}

        {/* Fields */}
        <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5 sm:p-6">
          <h3
            className="text-xs text-[#64748b] uppercase tracking-wide mb-5"
            style={{ fontWeight: 600 }}
          >
            Informasi Akun
          </h3>
          {editing && (
            <p className="text-[10px] text-[#94a3b8] mb-4 -mt-1">
              <span className="text-red-500">*</span> Wajib diisi
            </p>
          )}
          <div className="space-y-5">
            {fields.map((f) => (
              <div key={f.key}>
                <label
                  className="block text-[10px] text-[#94a3b8] mb-1.5 uppercase tracking-wide"
                  style={{ fontWeight: 600 }}
                >
                  {f.label}
                  {f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {editing ? (
                  f.key === "email" ? (
                    /* Email terkunci — dari akun login */
                    <div className="relative">
                      <input
                        type="email"
                        value={draft.email}
                        readOnly
                        className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-[#e2e8f0] text-sm text-[#64748b] bg-[#f8fafc] cursor-not-allowed"
                      />
                      <div
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8]"
                        title="Email diambil dari akun login"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <rect
                            x="3"
                            y="11"
                            width="18"
                            height="11"
                            rx="2"
                            ry="2"
                          />
                          <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                      </div>
                      <p className="text-[10px] text-[#94a3b8] mt-1">
                        Terhubung dari akun login Anda
                      </p>
                    </div>
                  ) : (
                    <input
                      type={f.type || "text"}
                      value={draft[f.key] as string}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [f.key]: e.target.value,
                        }))
                      }
                      placeholder={f.placeholder}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#e2e8f0] text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 focus:border-[#1e40af] transition-all"
                    />
                  )
                ) : (
                  <p
                    className={`text-sm px-0.5 ${
                      profile[f.key] as string
                        ? "text-[#1e293b]"
                        : "text-[#94a3b8] italic"
                    }`}
                  >
                    {profile[f.key] as string || f.placeholder}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onLogout}
          className="w-full py-2.5 rounded-xl border border-[#fee2e2] bg-[#fff5f5] text-[#ef4444] text-sm hover:bg-[#fee2e2] transition-colors flex items-center justify-center gap-2"
          style={{ fontWeight: 500 }}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Keluar dari Akun
        </button>
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
// ── SOP Management (Admin only) ───────────────────────────────────────────────

function formatFileSize(bytes: number) {
  if (bytes >= 1000000) return `${(bytes / 1000000).toFixed(1)} MB`
  return `${Math.round(bytes / 1000)} KB`
}

const CAT_COLORS: Record<string, string> = {
  SGN: "#1e40af",
  Holding: "#7c3aed",
  Perpres: "#0369a1",
  Permen: "#0f766e",
}
function getCatColor(cat: string) {
  return CAT_COLORS[cat] ?? "#64748b"
}

function SopManagementPage({ profile }: { profile: UserProfile }) {
  const [docs, setDocs] = useState<SopDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [categories, setCategories] = useState<string[]>([
    "SGN",
    "Holding",
    "Perpres",
    "Permen",
  ])

  useEffect(() => {
    setDocsLoading(true)
    proxiedFetch(N8N_GET_SOP_DOCS_URL, { method: "GET" })
      .then((r) => r.json())
      .then((data: SopDoc[]) => {
        const arr = Array.isArray(data) ? data : []
        setDocs(arr.map((d) => ({ ...d, uploadedAt: new Date(d.uploadedAt) })))
        const cats = [...new Set(arr.map((d) => d.category))].filter(Boolean)
        if (cats.length > 0) {
          setCategories((prev) => [...new Set([...prev, ...cats])])
        }
      })
      .catch(() => {})
      .finally(() => setDocsLoading(false))
  }, [])
  const [filterCat, setFilterCat] = useState<string>("Semua")
  const [search, setSearch] = useState("")
  const [showUpload, setShowUpload] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [newCatName, setNewCatName] = useState("")
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [confirmDelCat, setConfirmDelCat] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dragFileIdx, setDragFileIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [dragOverCat, setDragOverCat] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const catInputRef = useRef<HTMLInputElement>(null)

  const handleAddCategory = () => {
    const name = newCatName.trim()
    if (!name || categories.includes(name)) return
    setCategories((prev) => [...prev, name])
    setNewCatName("")
    setShowAddCat(false)
  }

  const handleDeleteCategory = (cat: string) => {
    setCategories((prev) => prev.filter((c) => c !== cat))
    setDocs((prev) => prev.filter((d) => d.category !== cat))
    if (filterCat === cat) setFilterCat("Semua")
    setConfirmDelCat(null)
  }

  const filtered = docs.filter((d) => {
    const matchCat = filterCat === "Semua" || d.category === filterCat
    const matchSearch =
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.fileName.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  const ALLOWED_EXTS = [".pdf", ".doc", ".docx"]
  const isAllowedFile = (name: string) =>
    ALLOWED_EXTS.some((ext) => name.toLowerCase().endsWith(ext))
  const [pendingFiles, setPendingFiles] = useState<{
    name: string
    size: number
    dataUrl: string
    category: string
    auto: boolean
  }[]>([])
  const [uploadCategory, setUploadCategory] = useState(categories[0] ?? "SGN")

  // Keyword map: category → keywords to look for in filename (case-insensitive)
  const CAT_KEYWORDS: Record<string, string[]> = {
    SGN: ["sgn", "pt-sgn", "ptsgn"],
    Holding: ["holding", "hld", "grup", "group"],
    Perpres: ["perpres", "pp-", "peraturan-pemerintah", "peraturanpemerintah"],
    Permen: [
      "permen",
      "permenko",
      "permendag",
      "permen-",
      "esdm",
      "peraturan-menteri",
    ],
  }

  const detectCatFromName = (fileName: string): {
    cat: string
    auto: boolean
  } => {
    const lower = fileName.toLowerCase().replace(/[_\s]/g, "-")
    // Check dynamic categories first
    for (const cat of categories) {
      const keywords = CAT_KEYWORDS[cat] ?? [cat.toLowerCase()]
      if (keywords.some((kw) => lower.includes(kw))) return { cat, auto: true }
    }
    // Fallback: check if any category name appears in filename
    for (const cat of categories) {
      if (lower.includes(cat.toLowerCase())) return { cat, auto: true }
    }
    return { cat: uploadCategory, auto: false }
  }

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((res) => {
      const r = new FileReader()
      r.onload = (e) => res(e.target?.result as string)
      r.readAsDataURL(file)
    })

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => isAllowedFile(f.name))
    const read = await Promise.all(
      arr.map(async (f) => {
        const { cat, auto } = detectCatFromName(f.name)
        return {
          name: f.name,
          size: f.size,
          dataUrl: await readFileAsDataUrl(f),
          category: cat,
          auto,
        }
      }),
    )
    setPendingFiles((prev) => {
      const names = new Set(prev.map((p) => p.name))
      return [...prev, ...read.filter((f) => !names.has(f.name))]
    })
  }

  const folderRef = useRef<HTMLInputElement>(null)

  const addFolderFiles = async (files: FileList) => {
    const arr = Array.from(files).filter((f) => isAllowedFile(f.name))
    const read = await Promise.all(
      arr.map(async (f) => {
        const parts =
          (f as File & {
            webkitRelativePath?: string
          }).webkitRelativePath?.split("/") ?? []
        // subfolder name = second-to-last segment (root/SubFolder/file.pdf)
        const subFolder = parts.length >= 3 ? parts[parts.length - 2] : null
        // Check if subfolder matches an existing category or create new one
        let cat = uploadCategory
        let auto = false
        if (subFolder) {
          const match = categories.find(
            (c) => c.toLowerCase() === subFolder.toLowerCase(),
          )
          if (match) {
            cat = match
            auto = true
          } else {
            cat = subFolder
            auto = true
          }
        }
        return {
          name: f.name,
          size: f.size,
          dataUrl: await readFileAsDataUrl(f),
          category: cat,
          auto,
        }
      }),
    )
    // Auto-create new categories found in subfolders
    const newCats = [
      ...new Set(read.filter((f) => f.auto).map((f) => f.category)),
    ].filter((c) => !categories.includes(c))
    if (newCats.length > 0) setCategories((prev) => [...prev, ...newCats])
    setPendingFiles((prev) => {
      const names = new Set(prev.map((p) => p.name))
      return [...prev, ...read.filter((f) => !names.has(f.name))]
    })
  }

  const [uploading, setUploading] = useState(false)

  const handleUpload = async () => {
    if (pendingFiles.length === 0) return
    setUploading(true)
    try {
      const results = await Promise.all(
        pendingFiles.map(async (f) => {
          const body = JSON.stringify({
            fileName: f.name,
            fileSize: f.size,
            fileDataUrl: f.dataUrl,
            category: f.category,
            title: f.name.replace(/\.[^.]+$/, ""),
            uploadedBy: profile.name || "Admin",
          })
          const res = await proxiedFetch(N8N_UPLOAD_SOP_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          })
          return res.ok ? await res.json() : null
        }),
      )
      const newDocs: SopDoc[] = results
        .filter(Boolean)
        .map((d: SopDoc) => ({ ...d, uploadedAt: new Date(d.uploadedAt) }))
      setDocs((prev) => [...newDocs, ...prev])
    } catch {}
    setUploading(false)
    setPendingFiles([])
    setShowUpload(false)
    if (fileRef.current) fileRef.current.value = ""
  }

  const catCounts: Record<string, number> = { Semua: docs.length }
  categories.forEach((c) => {
    catCounts[c] = docs.filter((d) => d.category === c).length
  })

  if (docsLoading)
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1e40af] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#64748b]">Memuat dokumen SOP...</p>
        </div>
      </div>
    )

  return (
    <div
      className="flex-1 overflow-auto p-4 sm:p-6"
      style={{
        background:
          "linear-gradient(160deg, #f0f6ff 0%, #f8fafc 40%, #f0fbff 100%)",
      }}
    >
      {/* Header actions */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari dokumen SOP..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#e2e8f0] rounded-xl text-sm text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/15 focus:border-[#1e40af] transition-all"
          />
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm transition-colors"
          style={{
            fontWeight: 600,
            background:
              "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
          }}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Upload SOP
        </button>
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {/* "Semua" tab */}
        <button
          onClick={() => setFilterCat("Semua")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all border"
          style={{
            fontWeight: filterCat === "Semua" ? 600 : 400,
            background: filterCat === "Semua" ? "#1e40af" : "#fff",
            color: filterCat === "Semua" ? "#fff" : "#64748b",
            borderColor: filterCat === "Semua" ? "transparent" : "#e2e8f0",
          }}
        >
          Semua
          <span
            className="px-1.5 py-0.5 rounded-full text-[10px]"
            style={{
              background:
                filterCat === "Semua" ? "rgba(255,255,255,0.25)" : "#f1f5f9",
              color: filterCat === "Semua" ? "#fff" : "#94a3b8",
            }}
          >
            {docs.length}
          </span>
        </button>

        {/* Per-category tabs with delete */}
        {categories.map((cat) => (
          <div key={cat} className="relative group/cat flex items-center">
            {confirmDelCat === cat && (
              <div className="absolute bottom-full mb-1.5 left-0 z-20 bg-white border border-red-200 rounded-xl shadow-lg px-3 py-2 flex items-center gap-2 whitespace-nowrap">
                <p
                  className="text-[11px] text-[#334155]"
                  style={{ fontWeight: 500 }}
                >
                  Hapus kategori?
                </p>
                <button
                  onClick={() => setConfirmDelCat(null)}
                  className="text-[10px] text-[#64748b] border border-[#e2e8f0] px-2 py-1 rounded-lg hover:bg-[#f8fafc]"
                >
                  Batal
                </button>
                <button
                  onClick={() => handleDeleteCategory(cat)}
                  className="text-[10px] text-white bg-red-500 px-2 py-1 rounded-lg hover:bg-red-600"
                >
                  Hapus
                </button>
              </div>
            )}
            <button
              onClick={() => setFilterCat(cat)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all border"
              style={{
                fontWeight: filterCat === cat ? 600 : 400,
                background: filterCat === cat ? getCatColor(cat) : "#fff",
                color: filterCat === cat ? "#fff" : "#64748b",
                borderColor: filterCat === cat ? "transparent" : "#e2e8f0",
              }}
            >
              {cat}
              <span
                className="px-1.5 py-0.5 rounded-full text-[10px]"
                style={{
                  background:
                    filterCat === cat ? "rgba(255,255,255,0.25)" : "#f1f5f9",
                  color: filterCat === cat ? "#fff" : "#94a3b8",
                }}
              >
                {catCounts[cat] ?? 0}
              </span>
            </button>
            {/* Delete category button — visible on hover */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelCat(cat)
              }}
              className="ml-0.5 w-4 h-4 rounded-full bg-[#f1f5f9] text-[#94a3b8] hover:bg-red-100 hover:text-red-500 transition-colors items-center justify-center hidden group-hover/cat:flex"
              title="Hapus kategori"
            >
              <svg
                className="w-2.5 h-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add category */}
        {showAddCat ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={catInputRef}
              autoFocus
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCategory()
                if (e.key === "Escape") {
                  setShowAddCat(false)
                  setNewCatName("")
                }
              }}
              placeholder="Nama kategori"
              className="px-3 py-1.5 rounded-lg border border-[#1e40af]/40 text-xs text-[#1e293b] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#1e40af]/20 w-32"
            />
            <button
              onClick={handleAddCategory}
              className="px-2.5 py-1.5 rounded-lg text-xs text-white"
              style={{
                fontWeight: 600,
                background:
                  "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
              }}
            >
              Tambah
            </button>
            <button
              onClick={() => {
                setShowAddCat(false)
                setNewCatName("")
              }}
              className="px-2 py-1.5 rounded-lg text-xs text-[#64748b] border border-[#e2e8f0] hover:bg-[#f8fafc]"
            >
              Batal
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddCat(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-[#1e40af] border border-dashed border-[#1e40af]/40 hover:bg-[#e8f0fe] transition-colors whitespace-nowrap"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Tambah Kategori
          </button>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setShowUpload(false)
              setPendingFiles([])
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-base text-[#1e293b]"
                style={{ fontWeight: 700 }}
              >
                Upload Dokumen SOP
              </h3>
              <button
                onClick={() => {
                  setShowUpload(false)
                  setPendingFiles([])
                }}
                className="w-7 h-7 rounded-full bg-[#f1f5f9] flex items-center justify-center hover:bg-[#e2e8f0] transition-colors"
              >
                <svg
                  className="w-4 h-4 text-[#64748b]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  if (e.dataTransfer.files.length)
                    addFiles(e.dataTransfer.files)
                }}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all"
                style={{
                  borderColor: dragOver ? "#1e40af" : "#e2e8f0",
                  background: dragOver ? "#f0f6ff" : "#fafbfc",
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    if (fileRef.current) fileRef.current.value = ""
                  }}
                />
                <svg
                  className="w-9 h-9 mx-auto mb-2 text-[#94a3b8]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p
                  className="text-sm text-[#334155]"
                  style={{ fontWeight: 600 }}
                >
                  Drag & drop file di sini
                </p>
                <p className="text-xs text-[#94a3b8] mt-1">
                  PDF, DOC, DOCX · bisa banyak sekaligus
                </p>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#f1f5f9]" />
                <span className="text-[11px] text-[#94a3b8]">atau</span>
                <div className="flex-1 h-px bg-[#f1f5f9]" />
              </div>

              {/* Folder upload */}
              <button
                onClick={() => folderRef.current?.click()}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl border border-[#e2e8f0] text-sm text-[#334155] hover:border-[#1e40af]/40 hover:bg-[#f0f6ff] transition-all"
              >
                <input
                  ref={folderRef}
                  type="file"
                  className="hidden"
                  {...{
                    webkitdirectory: "",
                    multiple: true,
                  } as React.InputHTMLAttributes<HTMLInputElement>}
                  onChange={(e) => {
                    if (e.target.files) addFolderFiles(e.target.files)
                    if (folderRef.current) folderRef.current.value = ""
                  }}
                />
                <svg
                  className="w-5 h-5 text-[#1e40af]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <div className="text-left">
                  <p
                    className="text-sm text-[#334155]"
                    style={{ fontWeight: 600 }}
                  >
                    Upload Folder
                  </p>
                  <p className="text-[10px] text-[#94a3b8]">
                    File dipisah otomatis berdasarkan nama subfolder → kategori
                  </p>
                </div>
                <svg
                  className="w-4 h-4 text-[#94a3b8] ml-auto"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Kategori default */}
              <div>
                <label
                  className="block text-xs text-[#334155] mb-1.5"
                  style={{ fontWeight: 600 }}
                >
                  Kategori
                </label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setUploadCategory(cat)
                        setPendingFiles((prev) =>
                          prev.map((f) => ({ ...f, category: cat })),
                        )
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs border transition-all"
                      style={{
                        fontWeight: uploadCategory === cat ? 700 : 400,
                        background:
                          uploadCategory === cat ? getCatColor(cat) : "#fff",
                        color: uploadCategory === cat ? "#fff" : "#64748b",
                        borderColor:
                          uploadCategory === cat ? getCatColor(cat) : "#e2e8f0",
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* File list preview */}
              {pendingFiles.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-0.5">
                    <p className="text-[11px] text-[#64748b]">
                      <span style={{ fontWeight: 600 }}>
                        {pendingFiles.length} file
                      </span>{" "}
                      siap upload ·{" "}
                      <span className="text-[#10b981]">
                        {pendingFiles.filter((f) => f.auto).length} otomatis
                      </span>
                      {pendingFiles.filter((f) => !f.auto).length > 0 && (
                        <span className="text-amber-500">
                          {" "}
                          · {pendingFiles.filter((f) => !f.auto).length} manual
                        </span>
                      )}
                    </p>
                  </div>
                  {/* Drag-to-category drop targets */}
                  <div className="flex gap-1.5 flex-wrap">
                    {categories.map((cat) => (
                      <div
                        key={cat}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverCat(cat)
                        }}
                        onDragLeave={() => setDragOverCat(null)}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverCat(null)
                          if (dragFileIdx !== null)
                            setPendingFiles((prev) =>
                              prev.map((p, j) =>
                                j === dragFileIdx
                                  ? { ...p, category: cat, auto: false }
                                  : p,
                              ),
                            )
                          setDragFileIdx(null)
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] text-white border-2 transition-all"
                        style={{
                          fontWeight: 600,
                          background: getCatColor(cat),
                          borderColor:
                            dragOverCat === cat ? "#fff" : "transparent",
                          opacity: dragFileIdx !== null ? 1 : 0.6,
                          transform:
                            dragOverCat === cat ? "scale(1.06)" : "scale(1)",
                          boxShadow:
                            dragOverCat === cat
                              ? "0 0 0 3px rgba(255,255,255,0.4)"
                              : "none",
                        }}
                      >
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                        {cat}
                      </div>
                    ))}
                    {dragFileIdx !== null && (
                      <p className="text-[10px] text-[#94a3b8] self-center ml-1">
                        ← seret ke kategori
                      </p>
                    )}
                  </div>

                  <div className="border border-[#e2e8f0] rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    {pendingFiles.map((f, i) => (
                      <div
                        key={i}
                        draggable
                        onDragStart={() => {
                          setDragFileIdx(i)
                          setDragOverIdx(null)
                        }}
                        onDragEnd={() => {
                          setDragFileIdx(null)
                          setDragOverIdx(null)
                          setDragOverCat(null)
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverIdx(i)
                        }}
                        onDragLeave={() => setDragOverIdx(null)}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverIdx(null)
                          if (dragFileIdx === null || dragFileIdx === i) return
                          setPendingFiles((prev) => {
                            const arr = [...prev]
                            const [moved] = arr.splice(dragFileIdx, 1)
                            arr.splice(i, 0, moved)
                            return arr
                          })
                          setDragFileIdx(null)
                        }}
                        className="border-b border-[#f1f5f9] last:border-0 transition-all"
                        style={{
                          background:
                            dragOverIdx === i
                              ? "#f0f6ff"
                              : dragFileIdx === i
                                ? "#fafbfc"
                                : "#fff",
                          opacity: dragFileIdx === i ? 0.5 : 1,
                          borderTop:
                            dragOverIdx === i ? "2px solid #1e40af" : undefined,
                        }}
                      >
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          {/* Drag handle */}
                          <svg
                            className="w-4 h-4 text-[#cbd5e1] cursor-grab flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <circle cx="9" cy="6" r="1" fill="currentColor" />
                            <circle cx="9" cy="12" r="1" fill="currentColor" />
                            <circle cx="9" cy="18" r="1" fill="currentColor" />
                            <circle cx="15" cy="6" r="1" fill="currentColor" />
                            <circle cx="15" cy="12" r="1" fill="currentColor" />
                            <circle cx="15" cy="18" r="1" fill="currentColor" />
                          </svg>
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] flex-shrink-0"
                            style={{
                              fontWeight: 700,
                              background: getCatColor(f.category),
                            }}
                          >
                            {f.name.toLowerCase().endsWith(".pdf")
                              ? "PDF"
                              : "DOC"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-xs text-[#334155] truncate"
                              style={{ fontWeight: 500 }}
                            >
                              {f.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded text-white"
                                style={{
                                  fontWeight: 600,
                                  background: getCatColor(f.category),
                                }}
                              >
                                {f.category}
                              </span>
                              {f.auto ? (
                                <span className="text-[9px] text-[#10b981] flex items-center gap-0.5">
                                  <svg
                                    className="w-2.5 h-2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2.5}
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M9 12l2 2 4-4" />
                                    <circle cx="12" cy="12" r="10" />
                                  </svg>
                                  Otomatis
                                </span>
                              ) : (
                                <span className="text-[9px] text-amber-500">
                                  Manual
                                </span>
                              )}
                              <span className="text-[10px] text-[#94a3b8]">
                                {formatFileSize(f.size)}
                              </span>
                            </div>
                            {/* Inline category buttons */}
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {categories.map((cat) => (
                                <button
                                  key={cat}
                                  onClick={() =>
                                    setPendingFiles((prev) =>
                                      prev.map((p, j) =>
                                        j === i
                                          ? { ...p, category: cat, auto: false }
                                          : p,
                                      ),
                                    )
                                  }
                                  className="px-1.5 py-0.5 rounded text-[9px] border transition-all"
                                  style={{
                                    fontWeight: f.category === cat ? 700 : 400,
                                    background:
                                      f.category === cat
                                        ? getCatColor(cat)
                                        : "#fff",
                                    color:
                                      f.category === cat ? "#fff" : "#94a3b8",
                                    borderColor:
                                      f.category === cat
                                        ? getCatColor(cat)
                                        : "#e2e8f0",
                                  }}
                                >
                                  {cat}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={() =>
                              setPendingFiles((prev) =>
                                prev.filter((_, j) => j !== i),
                              )
                            }
                            className="text-[#cbd5e1] hover:text-red-400 transition-colors flex-shrink-0 self-start mt-1"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2.5}
                              viewBox="0 0 24 24"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setShowUpload(false)
                    setPendingFiles([])
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-[#e2e8f0] text-sm text-[#64748b] hover:bg-[#f8fafc] transition-colors"
                  style={{ fontWeight: 500 }}
                >
                  Batal
                </button>
                <button
                  onClick={handleUpload}
                  disabled={pendingFiles.length === 0 || uploading}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white transition-all disabled:opacity-40"
                  style={{
                    fontWeight: 600,
                    background:
                      "linear-gradient(135deg, rgb(30, 64, 175) 0%, rgb(37, 99, 235) 100%)",
                  }}
                >
                  {uploading
                    ? "Mengupload..."
                    : pendingFiles.length > 0
                      ? `Upload ${pendingFiles.length} File`
                      : "Upload"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Doc list — Kanban view per category with drag & drop */}
      {docs.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 bg-[#f1f5f9] rounded-full flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-6 h-6 text-[#94a3b8]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-[#334155]" style={{ fontWeight: 500 }}>
            Tidak ada dokumen
          </p>
          <p className="text-xs text-[#94a3b8] mt-1">
            Upload SOP baru untuk memulai
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {(filterCat === "Semua" ? categories : [filterCat]).map((cat) => {
            const colDocs = docs.filter(
              (d) =>
                d.category === cat &&
                (search === "" ||
                  d.title.toLowerCase().includes(search.toLowerCase()) ||
                  d.fileName.toLowerCase().includes(search.toLowerCase())),
            )
            return (
              <div
                key={cat}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverCat(cat)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDragOverCat(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverCat(null)
                  const id = e.dataTransfer.getData("docId")
                  if (id)
                    setDocs((prev) =>
                      prev.map((d) =>
                        d.id === id ? { ...d, category: cat } : d,
                      ),
                    )
                }}
                className="flex flex-col rounded-2xl border-2 transition-all overflow-hidden"
                style={{
                  borderColor:
                    dragOverCat === cat ? getCatColor(cat) : "#e2e8f0",
                  background:
                    dragOverCat === cat ? `${getCatColor(cat)}08` : "#f8fafc",
                  minHeight: 120,
                }}
              >
                {/* Column header */}
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ background: getCatColor(cat) }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-white text-sm"
                      style={{ fontWeight: 700 }}
                    >
                      {cat}
                    </span>
                    <span className="text-white/70 text-[11px] bg-white/20 px-1.5 py-0.5 rounded-full">
                      {colDocs.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 p-2 space-y-2">
                  {colDocs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-6 text-center opacity-40">
                      <svg
                        className="w-6 h-6 text-[#94a3b8] mb-1"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        viewBox="0 0 24 24"
                      >
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-[11px] text-[#94a3b8]">
                        Seret file ke sini
                      </p>
                    </div>
                  )}
                  {colDocs.map((doc) => (
                    <div
                      key={doc.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("docId", doc.id)
                        e.dataTransfer.effectAllowed = "move"
                      }}
                      className="relative bg-white border border-[#e2e8f0] rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-[#1e40af]/30 transition-all group"
                      style={{ userSelect: "none" }}
                    >
                      {confirmDel === doc.id && (
                        <div className="absolute inset-0 bg-white border border-red-200 rounded-xl flex items-center justify-between px-3 gap-2 z-10">
                          <p
                            className="text-xs text-[#334155]"
                            style={{ fontWeight: 500 }}
                          >
                            Hapus?
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setConfirmDel(null)}
                              className="text-[10px] text-[#64748b] border border-[#e2e8f0] px-2 py-1 rounded-lg hover:bg-[#f8fafc]"
                            >
                              Batal
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await proxiedFetch(N8N_DELETE_SOP_URL, {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({ id: doc.id }),
                                  })
                                } catch {}
                                setDocs((prev) =>
                                  prev.filter((d) => d.id !== doc.id),
                                )
                                setConfirmDel(null)
                              }}
                              className="text-[10px] text-white bg-red-500 px-2 py-1 rounded-lg hover:bg-red-600"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="flex items-start gap-2.5">
                        {/* Drag grip */}
                        <svg
                          className="w-3.5 h-3.5 text-[#cbd5e1] mt-0.5 flex-shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <circle cx="7" cy="5" r="1.2" />
                          <circle cx="7" cy="10" r="1.2" />
                          <circle cx="7" cy="15" r="1.2" />
                          <circle cx="13" cy="5" r="1.2" />
                          <circle cx="13" cy="10" r="1.2" />
                          <circle cx="13" cy="15" r="1.2" />
                        </svg>
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[9px] flex-shrink-0"
                          style={{
                            fontWeight: 700,
                            background: getCatColor(doc.category),
                          }}
                        >
                          {doc.fileName.toLowerCase().endsWith(".pdf")
                            ? "PDF"
                            : "DOC"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-xs text-[#1e293b] leading-tight"
                            style={{ fontWeight: 600 }}
                          >
                            {doc.title}
                          </p>
                          <p className="text-[10px] text-[#94a3b8] mt-0.5 truncate">
                            {doc.fileName} · {formatFileSize(doc.fileSize)}
                          </p>
                          <p className="text-[10px] text-[#94a3b8]">
                            {doc.uploadedAt.toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <a
                            href={doc.fileDataUrl}
                            download={doc.fileName}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 rounded text-[#94a3b8] hover:text-[#1e40af] hover:bg-[#e8f0fe] transition-colors"
                            title="Unduh"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                            >
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </a>
                          <button
                            onClick={() => setConfirmDel(doc.id)}
                            className="p-1 rounded text-[#94a3b8] hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Hapus"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const PAGE_META: Record<Page, { title: string subtitle?: string }> = {
  login: { title: "" },
  dashboard: { title: "Dashboard", subtitle: "Ringkasan aktivitas Anda" },
  chat: { title: "Chat AI", subtitle: "Tanyakan SOP & prosedur perusahaan" },
  history: { title: "Riwayat Chat", subtitle: "Semua percakapan sebelumnya" },
  profile: { title: "Profil Saya", subtitle: "Kelola informasi akun Anda" },
  sop: { title: "Manajemen SOP", subtitle: "Kelola dokumen SOP perusahaan" },
}

// ── localStorage helpers ──────────────────────────────────────────────────────
// Riwayat chat DIPISAH per akun. Key = `sgn_chat_sessions_${userId}` sehingga
// riwayat admin dan user tidak pernah tercampur di device/browser yang sama.
function chatStorageKey(userId: string) {
  return `sgn_chat_sessions_${userId}`
}

// Turunkan identitas unik & stabil dari akun yang login (email di-lowercase).
function deriveUserId(profile: UserProfile): string {
  return (profile.email || profile.nik || "").toLowerCase()
}

function loadSessions(userId: string): ChatSession[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(chatStorageKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<ChatSession & {
      updatedAt: string
      messages: Array<Message & { timestamp: string }>
    }>
    return parsed.map((s) => ({
      ...s,
      updatedAt: new Date(s.updatedAt),
      messages: s.messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    }))
  } catch {
    return []
  }
}

function saveSessions(userId: string, sessions: ChatSession[]) {
  if (!userId) return
  try {
    localStorage.setItem(chatStorageKey(userId), JSON.stringify(sessions))
  } catch {}
}

export default function App() {
  const [page, setPage] = useState<Page>("login")
  const [showRegister, setShowRegister] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Riwayat chat baru dimuat SETELAH login, khusus milik akun yang bersangkutan.
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [weeklyCount, setWeeklyCount] = useState(12)
  const [profile, setProfile] = useState<UserProfile>({
    name: "",
    email: "",
    jabatan: "",
    departemen: "",
    perusahaan: "PT SGN",
    nik: "",
  })

  // Persist sessions ke localStorage per akun yang sedang login.
  useEffect(() => {
    if (currentUserId) saveSessions(currentUserId, sessions)
  }, [sessions, currentUserId])

  const handleLogout = () => {
    // Bersihkan riwayat dari memory/state sebelum akun lain login di device ini.
    setSessions([])
    setActiveChatId(null)
    setCurrentUserId(null)
    setProfile({
      name: "",
      email: "",
      jabatan: "",
      departemen: "",
      perusahaan: "PT SGN",
      nik: "",
    })
    setPage("login")
  }

  if (page === "login" && showRegister)
    return <RegisterPage onBack={() => setShowRegister(false)} />

  if (page === "login")
    return (
      <LoginPage
        onRegister={() => setShowRegister(true)}
        onLogin={(account) => {
          const nextProfile: UserProfile = {
            email: account.email,
            name: account.name,
            jabatan: account.jabatan,
            departemen: account.departemen,
            nik: account.nik,
            perusahaan: "PT SGN",
            role: account.role,
          }
          setProfile(nextProfile)
          // Muat HANYA riwayat chat milik akun ini.
          const userId = deriveUserId(nextProfile)
          setCurrentUserId(userId)
          setSessions(loadSessions(userId))
          setActiveChatId(null)
          setPage("dashboard")
        }}
      />
    )

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        page={page}
        setPage={setPage}
        onLogout={handleLogout}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        role={profile.role}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header
          title={PAGE_META[page].title}
          subtitle={PAGE_META[page].subtitle}
          onMenuOpen={() => setSidebarOpen(true)}
          profile={profile}
          setProfile={setProfile}
          onLogout={handleLogout}
        />
        {page === "dashboard" && (
          <DashboardPage
            setPage={setPage}
            weeklyCount={weeklyCount}
            sessions={sessions}
          />
        )}
        {page === "chat" && (
          <ChatPage
            userId={currentUserId ?? ""}
            sessions={sessions}
            setSessions={setSessions}
            onWeeklyCount={() => setWeeklyCount((v) => v + 1)}
            openSessionId={activeChatId}
            onClearOpenSession={() => setActiveChatId(null)}
          />
        )}
        {page === "history" && (
          <HistoryPage
            sessions={sessions}
            setSessions={setSessions}
            setPage={setPage}
            setActiveChat={setActiveChatId}
          />
        )}
        {page === "profile" && (
          <ProfilePage
            profile={profile}
            setProfile={setProfile}
            onLogout={handleLogout}
          />
        )}
        {page === "sop" && profile.role === "admin" && (
          <SopManagementPage profile={profile} />
        )}
      </div>
    </div>
  )
}
