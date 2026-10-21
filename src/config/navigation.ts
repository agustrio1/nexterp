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
  Wallet,
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
  Contact,
  Target,
  Kanban,
  Funnel,
  Activity,
  ListChecks,
  StickyNote,
  Layers,
  UserCog,
  Tags,
  UserRound,
  Clock,
  CalendarCheck,
  CalendarDays,
  Timer,
  FileSignature,
  FolderClosed,
  Star,
  GraduationCap,
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
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
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
    title: "Kas & Bank",
    items: [
      { label: "Rekening Kas & Bank", href: "/treasury/bank-accounts", icon: Wallet, permission: "accounting.bank_accounts.read" },
      { label: "Transaksi Kas", href: "/treasury/cash-transactions", icon: Coins, permission: "accounting.cash_transactions.read" },
      { label: "Mutasi Bank", href: "/treasury/statements", icon: ScrollText, permission: "accounting.bank_reconciliations.read" },
      { label: "Rekonsiliasi Bank", href: "/treasury/reconciliations", icon: Landmark, permission: "accounting.bank_reconciliations.read" },
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
    title: "CRM",
    items: [
      { label: "Akun", href: "/crm/accounts", icon: Building2, permission: "crm.accounts.read" },
      { label: "Kontak", href: "/crm/contacts", icon: Contact, permission: "crm.contacts.read" },
      { label: "Leads", href: "/crm/leads", icon: Target, permission: "crm.leads.read" },
      { label: "Pipeline", href: "/crm/pipeline", icon: Kanban, permission: "crm.pipeline.read" },
      { label: "Peluang", href: "/crm/opportunities", icon: Funnel, permission: "crm.opportunities.read" },
      { label: "Aktivitas", href: "/crm/activities", icon: Activity, permission: "crm.activities.read" },
      { label: "Tugas", href: "/crm/tasks", icon: ListChecks, permission: "crm.tasks.read" },
      { label: "Catatan", href: "/crm/notes", icon: StickyNote, permission: "crm.notes.read" },
      { label: "Segmen", href: "/crm/segments", icon: Layers, permission: "crm.segments.read" },
      { label: "Pelanggan", href: "/crm/customers", icon: UserCog, permission: "crm.customers.read" },
      { label: "Daftar Harga", href: "/crm/price-lists", icon: Tags, permission: "crm.price_lists.read" },
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
    title: "SDM",
    items: [
      { label: "Karyawan", href: "/hr/employees", icon: Users, permission: "hr.employees.read" },
      { label: "HR Saya", href: "/hr/me", icon: UserRound, permission: "hr.self.view" },
      { label: "Jabatan", href: "/hr/positions", icon: Briefcase, permission: "hr.positions.read" },
      { label: "Shift", href: "/hr/shifts", icon: Clock, permission: "hr.shifts.read" },
      { label: "Absensi", href: "/hr/attendance", icon: CalendarCheck, permission: "hr.attendance.read" },
      { label: "Cuti", href: "/hr/leaves", icon: CalendarDays, permission: "hr.leaves.read" },
      { label: "Lembur", href: "/hr/overtime", icon: Timer, permission: "hr.overtime.read" },
      { label: "Kontrak", href: "/hr/contracts", icon: FileSignature, permission: "hr.contracts.read" },
      { label: "Dokumen Karyawan", href: "/hr/documents", icon: FolderClosed, permission: "hr.documents.read" },
      { label: "Evaluasi Kinerja", href: "/hr/evaluations", icon: Star, permission: "hr.evaluations.read" },
      { label: "Pelatihan", href: "/hr/training", icon: GraduationCap, permission: "hr.training.read" },
    ],
  },
  {
    title: "Payroll",
    items: [
      { label: "Run Payroll", href: "/payroll/runs", icon: ClipboardList, permission: "payroll.runs.read" },
      { label: "Periode Payroll", href: "/payroll/periods", icon: Calendar, permission: "payroll.periods.read" },
      { label: "Payroll Saya", href: "/payroll/me", icon: UserRound, permission: "payroll.self.payslip" },
      { label: "Komponen Gaji", href: "/payroll/components", icon: ListChecks, permission: "payroll.components.read" },
      { label: "Struktur Gaji", href: "/payroll/structures", icon: BookOpen, permission: "payroll.structures.read" },
      { label: "Kompensasi Karyawan", href: "/payroll/compensations", icon: Coins, permission: "payroll.structures.read" },
      { label: "Aturan Statutory", href: "/payroll/statutory", icon: Landmark, permission: "payroll.statutory.read" },
      { label: "Penyesuaian Gaji", href: "/payroll/adjustments", icon: Settings, permission: "payroll.adjustments.read" },
      { label: "Slip Gaji", href: "/payroll/payslips", icon: Receipt, permission: "payroll.payslips.read" },
    ],
  },
  {
    title: "Aset Tetap",
    items: [
      { label: "Register Aset", href: "/assets/register", icon: Package, permission: "assets.register.read" },
      { label: "Kategori Aset", href: "/assets/categories", icon: Tags, permission: "assets.categories.read" },
      { label: "Akuisisi Aset", href: "/assets/acquisitions", icon: ShoppingCart, permission: "assets.acquisitions.read" },
      { label: "Run Penyusutan", href: "/assets/depreciation", icon: Timer, permission: "assets.depreciation.read" },
      { label: "Pelepasan Aset", href: "/assets/disposals", icon: FileMinus2, permission: "assets.disposal.read" },
      { label: "Revaluasi Aset", href: "/assets/revaluations", icon: RotateCcw, permission: "assets.register.read" },
    ],
  },
  {
    title: "Proyek",
    items: [
      { label: "Daftar Proyek", href: "/projects", icon: Briefcase, permission: "projects.master.read" },
    ],
  },
  {
    title: "AI",
    items: [
      { label: "Asisten AI", href: "/ai-assistant", icon: Bot, permission: "ai.assistant.use" },
    ],
  },
];
