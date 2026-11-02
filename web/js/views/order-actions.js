/* Ações de uma OS (menu da linha, do cartão e da tela de detalhe). */
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { navigate } from "../core/router.js";
import { isPaid, newOrder, nextOrderNumber, orderTotal, whatsappMessage, emptyReport } from "../core/model.js";
import { todayISO, whatsappLink } from "../core/format.js";
import { uid } from "../core/util.js";
import { confirm } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";

export async function printOrderSheet(order, mode = "print") {
  const { exportOrderSheet } = await import("../docs/order-doc.js");
  await exportOrderSheet(order, mode);
}

export async function reportPdf(order, mode = "pdf") {
  const { exportReport } = await import("../docs/report-doc.js");
  await exportReport(order, mode);
}

export function openWhatsapp(order, kind) {
  const link = whatsappLink(order.client?.phone || data.client(order.client?.id)?.phone, whatsappMessage(order, data.settings(), kind));
  if (!link) {
    toast.error("Cliente sem telefone", { description: "Cadastre o WhatsApp do cliente para enviar mensagens." });
    return;
  }
  window.open(link, "_blank", "noopener");
}

export function togglePaid(order) {
  const paid = isPaid(order);
  data.saveOrder({ ...order, payment: { ...order.payment, status: paid ? "pendente" : "pago", paidAt: paid ? "" : order.payment?.paidAt || todayISO() } });
  toast.success(paid ? `OS ${order.number} marcada como pendente` : `OS ${order.number} marcada como paga`);
}

export function duplicateOrder(order) {
  const settings = data.settings();
  const copy = newOrder(settings, {
    number: nextOrderNumber(data.orders(), settings),
    client: { ...order.client },
    equipment: { ...order.equipment },
    problem: order.problem,
    items: (order.items || []).map((item) => ({ ...item, id: uid("i") })),
    report: { ...emptyReport(), technician: order.report?.technician || "" },
  });
  data.saveOrder(copy);
  toast.success(`OS ${copy.number} criada a partir da ${order.number}`);
  navigate(`/ordens/${copy.id}`);
}

export async function deleteOrder(order, { after } = {}) {
  const ok = await confirm({
    title: `Excluir a OS ${order.number || ""}?`.replace("  ", " "),
    message: "A ordem, o relatório técnico e as fotos serão removidos. Uma cópia fica nos backups automáticos.",
    confirmLabel: "Excluir OS",
    danger: true,
  });
  if (!ok) return false;
  const removed = store.remove("orders", order.id);
  after?.();
  toast.success(`OS ${order.number} excluída`, {
    action: {
      label: "Desfazer",
      run: () => {
        store.restore("orders", removed);
        navigate(`/ordens/${order.id}`);
      },
    },
  });
  return true;
}

export function orderActions(order, { onChange, inDetail = false } = {}) {
  if (!order) return [];
  const hasPhone = Boolean(order.client?.phone);
  return [
    ...(inDetail ? [] : [{ label: "Abrir OS", icon: "arrowUpRight", run: () => navigate(`/ordens/${order.id}`) }]),
    { label: "Editar relatório técnico", icon: "fileText", run: () => navigate(`/ordens/${order.id}/relatorio`) },
    "-",
    { label: "Relatório técnico (PDF)", icon: "filePdf", run: () => reportPdf(order, "pdf") },
    { label: "Ordem de serviço (PDF)", icon: "receipt", hint: "Comprovante com itens e garantia", run: () => printOrderSheet(order, "pdf") },
    { label: "Imprimir ordem de serviço", icon: "printer", run: () => printOrderSheet(order, "print") },
    "-",
    { label: "Avisar no WhatsApp", icon: "message", disabled: !hasPhone, hint: hasPhone ? "" : "Cliente sem telefone", run: () => openWhatsapp(order) },
    ...(orderTotal(order) ? [{ label: isPaid(order) ? "Marcar como pendente" : "Marcar como paga", icon: "wallet", run: () => { togglePaid(order); onChange?.(); } }] : []),
    { label: "Duplicar OS", icon: "copy", run: () => duplicateOrder(order) },
    "-",
    { label: "Excluir OS", icon: "trash", danger: true, run: () => deleteOrder(order, { after: inDetail ? () => navigate("/ordens") : onChange }) },
  ];
}
