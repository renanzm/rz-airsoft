/* Ações de uma OS (menu da linha, do cartão e da tela de detalhe). */
import * as data from "../core/data.js";
import * as store from "../core/store.js";
import { navigate } from "../core/router.js";
import { isPaid, newOrder, nextOrderNumber, orderTotal, whatsappMessage, emptyReport } from "../core/model.js";
import { todayISO, whatsappLink } from "../core/format.js";
import { uid } from "../core/util.js";
import { confirm } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";
import { tr } from "../core/i18n.js";

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
    toast.error(tr("Cliente sem telefone"), { description: tr("Cadastre o WhatsApp do cliente para enviar mensagens.") });
    return;
  }
  window.open(link, "_blank", "noopener");
}

export function togglePaid(order) {
  const paid = isPaid(order);
  data.saveOrder({ ...order, payment: { ...order.payment, status: paid ? "pendente" : "pago", paidAt: paid ? "" : order.payment?.paidAt || todayISO() } });
  toast.success(paid ? tr("OS {n} marcada como pendente", { n: order.number }) : tr("OS {n} marcada como paga", { n: order.number }));
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
  toast.success(tr("OS {n} criada a partir da {from}", { n: copy.number, from: order.number }));
  navigate(`/ordens/${copy.id}`);
}

export async function deleteOrder(order, { after } = {}) {
  const ok = await confirm({
    title: tr("Excluir a OS {n}?", { n: order.number || "" }).replace("  ", " "),
    message: tr("A ordem, o relatório técnico e as fotos serão removidos. Uma cópia fica nos backups automáticos."),
    confirmLabel: tr("Excluir OS"),
    danger: true,
  });
  if (!ok) return false;
  const removed = store.remove("orders", order.id);
  after?.();
  toast.success(tr("OS {n} excluída", { n: order.number }), {
    action: {
      label: tr("Desfazer"),
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
    ...(inDetail ? [] : [{ label: tr("Abrir OS"), icon: "arrowUpRight", run: () => navigate(`/ordens/${order.id}`) }]),
    { label: tr("Editar relatório técnico"), icon: "fileText", run: () => navigate(`/ordens/${order.id}/relatorio`) },
    "-",
    { label: tr("Relatório técnico (PDF)"), icon: "filePdf", run: () => reportPdf(order, "pdf") },
    { label: tr("Ordem de serviço (PDF)"), icon: "receipt", hint: tr("Comprovante com itens e garantia"), run: () => printOrderSheet(order, "pdf") },
    { label: tr("Imprimir ordem de serviço"), icon: "printer", run: () => printOrderSheet(order, "print") },
    "-",
    { label: tr("Avisar no WhatsApp"), icon: "message", disabled: !hasPhone, hint: hasPhone ? "" : tr("Cliente sem telefone"), run: () => openWhatsapp(order) },
    ...(orderTotal(order) ? [{ label: isPaid(order) ? tr("Marcar como pendente") : tr("Marcar como paga"), icon: "wallet", run: () => { togglePaid(order); onChange?.(); } }] : []),
    { label: tr("Duplicar OS"), icon: "copy", run: () => duplicateOrder(order) },
    "-",
    { label: tr("Excluir OS"), icon: "trash", danger: true, run: () => deleteOrder(order, { after: inDetail ? () => navigate("/ordens") : onChange }) },
  ];
}
