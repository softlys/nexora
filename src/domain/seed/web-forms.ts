import type { WebForm } from "../entities";

/** The demo's website form ("Request a quote"), with a stable id so its embed code survives a reset. */
export function demoWebForm(organizationId: string, now: Date): WebForm {
  const at = now.toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000701",
    organization_id: organizationId,
    name: "Заявка с сайта",
    title: "Получить коммерческое предложение",
    button_text: "Отправить заявку",
    success_text: "Спасибо! Менеджер свяжется с вами в течение рабочего дня.",
    fields: { phone: "required", email: "optional", company: "optional", message: "optional" },
    owner_id: null,
    is_active: true,
    submissions: 0,
    created_at: at,
    updated_at: at,
  };
}
