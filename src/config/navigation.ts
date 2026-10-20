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
  Truck,
  Receipt,
  RotateCcw,
  FileMinus2,
  Tag,
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
      { label: "Bagan Akun", href: "/chart-of-accounts", icon: BookOpen, permission: "accounting.accounts.read" },
      { label: "Jurnal", href: "/journal-entries", icon: FileText, permission: "accounting.journals.read" },
      { label: "Buku Besar", href: "/general-ledger", icon: Landmark, permission: "accounting.reports.read" },
      { label: "Laporan Keuangan", href: "/reports", icon: BarChart3, permission: "accounting.reports.read" },
      { label: "Saldo Awal", href: "/opening-balance", icon: Coins, permission: "accounting.opening.manage" },
    ],
  },
  {
    title: "Inventori",
    items: [
      { label: "Produk", href: "/products", icon: Package, permission: "inventory.products.read" },
      { label: "Gudang", href: "/warehouses", icon: Warehouse, permission: "inventory.warehouses.read" },
      { label: "Dokumen Stok", href: "/stock-documents", icon: ClipboardList, permission: "inventory.documents.read" },
      { label: "Laporan Persediaan", href: "/inventory-reports", icon: BarChart3, permission: "inventory.stock.read" },
    ],
  },
  {
    title: "Pembelian",
    items: [
      { label: "Pemasok", href: "/purchasing/suppliers", icon: Users, permission: "purchasing.suppliers.read" },
      { label: "Purchase Order", href: "/purchasing/purchase-orders", icon: ShoppingCart, permission: "purchasing.purchase_orders.read" },
      { label: "Invoice Pemasok", href: "/purchasing/invoices", icon: FileText, permission: "purchasing.invoices.read" },
      { label: "Pembayaran AP", href: "/purchasing/payments", icon: CreditCard, permission: "purchasing.payments.read" },
      { label: "Laporan Pembelian", href: "/purchasing/reports", icon: BarChart3, permission: "purchasing.reports.read" },
    ],
  },
  {
    title: "Penjualan & AR",
    items: [
      { label: "Quotation", href: "/sales/quotations", icon: Tag, permission: "sales.quotations.read" },
      { label: "Sales Order", href: "/sales/sales-orders", icon: ClipboardList, permission: "sales.orders.read" },
      { label: "Pengiriman", href: "/sales/deliveries", icon: Truck, permission: "sales.deliveries.read" },
      { label: "Retur Penjualan", href: "/sales/returns", icon: RotateCcw, permission: "sales.returns.read" },
      { label: "Faktur Penjualan", href: "/sales/invoices", icon: Receipt, permission: "sales.invoices.read" },
      { label: "Pembayaran Customer", href: "/sales/payments", icon: CreditCard, permission: "sales.payments.read" },
      { label: "Nota Kredit", href: "/sales/credit-notes", icon: FileMinus2, permission: "sales.credit_notes.read" },
      { label: "Laporan Penjualan", href: "/sales/reports", icon: BarChart3, permission: "sales.reports.read" },
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
