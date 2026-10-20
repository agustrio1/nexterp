import {
  LayoutDashboard,
  Users,
  Shield,
  Building2,
  GitBranch,
  Briefcase,
  Calendar,
  Coins,
  ScrollText,
  BookOpen,
  FileText,
  Warehouse,
  ShoppingCart,
  ClipboardList,
  Package,
  CreditCard,
  Landmark,
  BarChart3,
  Bot,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission code yang diperlukan; kosong = semua user terautentikasi. */
  permission?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const navigationSections: NavSection[] = [
  {
    title: "Utama",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
    ],
  },
  {
    title: "Identitas & Akses",
    items: [
      { label: "Pengguna", href: "/users", icon: Users, permission: "core.user.read" },
      { label: "Role & Izin", href: "/roles", icon: Shield, permission: "core.role.read" },
      { label: "Audit Log", href: "/audit-logs", icon: ScrollText, permission: "core.audit.read" },
    ],
  },
  {
    title: "Organisasi",
    items: [
      { label: "Profil Perusahaan", href: "/company", icon: Building2, permission: "core.company.read" },
      { label: "Cabang", href: "/branches", icon: GitBranch, permission: "core.branch.read" },
      { label: "Departemen", href: "/departments", icon: Briefcase, permission: "core.department.read" },
      { label: "Tahun Fiskal", href: "/fiscal-years", icon: Calendar, permission: "core.fiscal.read" },
      { label: "Mata Uang & Kurs", href: "/currencies", icon: Coins, permission: "core.currency.read" },
      { label: "Pengaturan", href: "/settings", icon: Settings, permission: "core.setting.read" },
    ],
  },
  {
    title: "Akuntansi",
    items: [
      { label: "Bagan Akun", href: "/chart-of-accounts", icon: BookOpen, permission: "accounting.coa.read" },
      { label: "Jurnal", href: "/journal-entries", icon: FileText, permission: "accounting.journal.read" },
      { label: "Buku Besar", href: "/general-ledger", icon: Landmark, permission: "accounting.ledger.read" },
      { label: "Laporan Keuangan", href: "/reports", icon: BarChart3, permission: "accounting.report.read" },
    ],
  },
  {
    title: "Inventori & Procurement",
    items: [
      { label: "Gudang & Produk", href: "/inventory", icon: Warehouse, permission: "inventory.item.read" },
      { label: "Pembelian", href: "/purchasing", icon: ShoppingCart, permission: "purchasing.po.read" },
    ],
  },
  {
    title: "Penjualan & CRM",
    items: [
      { label: "Pelanggan", href: "/customers", icon: Users, permission: "crm.customer.read" },
      { label: "Penjualan", href: "/sales", icon: ClipboardList, permission: "sales.order.read" },
    ],
  },
  {
    title: "HR & Payroll",
    items: [
      { label: "Karyawan", href: "/employees", icon: Users, permission: "hr.employee.read" },
      { label: "Gaji", href: "/payroll", icon: CreditCard, permission: "payroll.run.read" },
    ],
  },
  {
    title: "Aset & Proyek",
    items: [
      { label: "Aset Tetap", href: "/assets", icon: Package, permission: "assets.asset.read" },
      { label: "Proyek", href: "/projects", icon: Briefcase, permission: "projects.project.read" },
    ],
  },
  {
    title: "AI",
    items: [
      { label: "Asisten AI", href: "/ai-assistant", icon: Bot, permission: "ai.chat" },
    ],
  },
];
