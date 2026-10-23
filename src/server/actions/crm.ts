"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  activityInput,
  commentInput,
  companyInput,
  companyUpdateInput,
  contactInput,
  contactUpdateInput,
  convertDealInput,
  convertLeadInput,
  dealInput,
  dealQuickEditInput,
  dealUpdateInput,
  leadInput,
  leadUpdateInput,
  moveStageInput,
  orderInput,
  orderStatusInput,
  orderUpdateInput,
  paymentInput,
  searchInput,
  taskInput,
  taskUpdateInput,
} from "@/domain/inputs";
import { serviceAction } from "@/server/service-action";
import { createCompany, updateCompany } from "@/server/services/companies";
import { createContact, updateContact } from "@/server/services/contacts";
import { createDeal, moveDealStage, quickEditDeal, updateDeal } from "@/server/services/deals";
import { convertLead, createLead, updateLead } from "@/server/services/leads";
import { changeOrderStatus, convertDealToOrder, createOrder, recordPayment, updateOrder } from "@/server/services/orders";
import { archiveRecord, hardDeleteRecord, restoreRecord, type OwnedTable } from "@/server/services/records";
import { globalSearch } from "@/server/services/search";
import { importCsv, importInput } from "@/server/services/imports";
import { addComment, createTask, logActivity, setTaskDone, updateTask } from "@/server/services/tasks";

const PATHS: Record<OwnedTable, string> = {
  companies: "/companies",
  contacts: "/contacts",
  leads: "/leads",
  deals: "/deals",
  orders: "/orders",
  tasks: "/tasks",
};

function refresh(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/", "layout");
}

// --- Companies -------------------------------------------------------------

export async function createCompanyAction(input: unknown) {
  return serviceAction({ name: "createCompany", schema: companyInput, bucket: "create" }, input, async (ctx, data) => {
    const company = await createCompany(ctx, data);
    refresh("/companies");
    return { id: company.id };
  });
}

export async function updateCompanyAction(input: unknown) {
  return serviceAction({ name: "updateCompany", schema: companyUpdateInput }, input, async (ctx, data) => {
    await updateCompany(ctx, data);
    refresh("/companies", `/companies/${data.id}`);
    return { id: data.id };
  });
}

// --- Contacts --------------------------------------------------------------

export async function createContactAction(input: unknown) {
  return serviceAction({ name: "createContact", schema: contactInput, bucket: "create" }, input, async (ctx, data) => {
    const contact = await createContact(ctx, data);
    refresh("/contacts");
    return { id: contact.id };
  });
}

export async function updateContactAction(input: unknown) {
  return serviceAction({ name: "updateContact", schema: contactUpdateInput }, input, async (ctx, data) => {
    await updateContact(ctx, data);
    refresh("/contacts", `/contacts/${data.id}`);
    return { id: data.id };
  });
}

// --- Leads -----------------------------------------------------------------

export async function createLeadAction(input: unknown) {
  return serviceAction({ name: "createLead", schema: leadInput, bucket: "create" }, input, async (ctx, data) => {
    const lead = await createLead(ctx, data);
    refresh("/leads");
    return { id: lead.id };
  });
}

export async function updateLeadAction(input: unknown) {
  return serviceAction({ name: "updateLead", schema: leadUpdateInput }, input, async (ctx, data) => {
    await updateLead(ctx, data);
    refresh("/leads", `/leads/${data.id}`);
    return { id: data.id };
  });
}

export async function convertLeadAction(input: unknown) {
  return serviceAction({ name: "convertLead", schema: convertLeadInput, bucket: "create" }, input, async (ctx, data) => {
    const result = await convertLead(ctx, data);
    refresh("/leads", "/deals", "/pipeline", "/companies", "/contacts");
    return result;
  });
}

// --- Deals and pipeline ----------------------------------------------------

export async function createDealAction(input: unknown) {
  return serviceAction({ name: "createDeal", schema: dealInput, bucket: "create" }, input, async (ctx, data) => {
    const deal = await createDeal(ctx, data);
    refresh("/deals", "/pipeline");
    return { id: deal.id };
  });
}

export async function updateDealAction(input: unknown) {
  return serviceAction({ name: "updateDeal", schema: dealUpdateInput }, input, async (ctx, data) => {
    await updateDeal(ctx, data);
    refresh("/deals", "/pipeline", `/deals/${data.id}`);
    return { id: data.id };
  });
}

export async function quickEditDealAction(input: unknown) {
  return serviceAction({ name: "quickEditDeal", schema: dealQuickEditInput }, input, async (ctx, data) => {
    const deal = await quickEditDeal(ctx, data);
    refresh("/deals", "/pipeline", `/deals/${data.id}`);
    return { id: deal.id, amount: deal.amount, probability: deal.probability, expected_close_date: deal.expected_close_date };
  });
}

export async function moveDealStageAction(input: unknown) {
  return serviceAction({ name: "moveDealStage", schema: moveStageInput }, input, async (ctx, data) => {
    const deal = await moveDealStage(ctx, data);
    refresh("/deals", "/pipeline", `/deals/${data.deal_id}`);
    return { id: deal.id, stage_id: deal.stage_id, probability: deal.probability, closed_at: deal.closed_at };
  });
}

// --- Orders ----------------------------------------------------------------

export async function createOrderAction(input: unknown) {
  return serviceAction({ name: "createOrder", schema: orderInput, bucket: "create" }, input, async (ctx, data) => {
    const order = await createOrder(ctx, data);
    refresh("/orders");
    return { id: order.id };
  });
}

export async function updateOrderAction(input: unknown) {
  return serviceAction({ name: "updateOrder", schema: orderUpdateInput }, input, async (ctx, data) => {
    await updateOrder(ctx, data);
    refresh("/orders", `/orders/${data.id}`);
    return { id: data.id };
  });
}

export async function changeOrderStatusAction(input: unknown) {
  return serviceAction({ name: "changeOrderStatus", schema: orderStatusInput }, input, async (ctx, data) => {
    await changeOrderStatus(ctx, data);
    refresh("/orders", `/orders/${data.id}`);
    return { id: data.id };
  });
}

export async function recordPaymentAction(input: unknown) {
  return serviceAction({ name: "recordPayment", schema: paymentInput, bucket: "create" }, input, async (ctx, data) => {
    const payment = await recordPayment(ctx, data);
    refresh("/orders", `/orders/${data.order_id}`);
    return { id: payment.id };
  });
}

export async function convertDealToOrderAction(input: unknown) {
  return serviceAction({ name: "convertDealToOrder", schema: convertDealInput, bucket: "create" }, input, async (ctx, data) => {
    const result = await convertDealToOrder(ctx, data.deal_id);
    refresh("/orders", "/deals", `/deals/${data.deal_id}`);
    return { order_id: result.order.id, order_number: result.order.order_number, created: result.created };
  });
}

// --- Tasks, activities, comments ------------------------------------------

export async function createTaskAction(input: unknown) {
  return serviceAction({ name: "createTask", schema: taskInput, bucket: "create" }, input, async (ctx, data) => {
    const task = await createTask(ctx, data);
    refresh("/tasks");
    return { id: task.id };
  });
}

export async function updateTaskAction(input: unknown) {
  return serviceAction({ name: "updateTask", schema: taskUpdateInput }, input, async (ctx, data) => {
    await updateTask(ctx, data);
    refresh("/tasks");
    return { id: data.id };
  });
}

export async function setTaskDoneAction(input: unknown) {
  return serviceAction({ name: "setTaskDone", schema: z.object({ id: z.uuid(), done: z.boolean() }).strict() }, input, async (ctx, data) => {
    const task = await setTaskDone(ctx, data.id, data.done);
    refresh("/tasks");
    return { id: task.id, status: task.status };
  });
}

export async function logActivityAction(input: unknown) {
  return serviceAction({ name: "logActivity", schema: activityInput, bucket: "create" }, input, async (ctx, data) => {
    const activity = await logActivity(ctx, data);
    refresh("/companies", "/contacts", "/deals", "/orders", "/leads");
    return { id: activity.id };
  });
}

export async function addCommentAction(input: unknown) {
  return serviceAction({ name: "addComment", schema: commentInput, bucket: "create" }, input, async (ctx, data) => {
    const comment = await addComment(ctx, data);
    refresh("/companies", "/contacts", "/deals", "/orders", "/leads", "/tasks");
    return { id: comment.id };
  });
}

// --- Archive / restore / delete -------------------------------------------

const tableInput = z
  .object({ id: z.uuid(), table: z.enum(["companies", "contacts", "leads", "deals", "orders", "tasks"]) })
  .strict();

export async function archiveRecordAction(input: unknown) {
  return serviceAction({ name: "archiveRecord", schema: tableInput }, input, async (ctx, data) => {
    await archiveRecord(ctx, data.table, data.id);
    refresh(PATHS[data.table], `${PATHS[data.table]}/${data.id}`, "/pipeline");
    return { id: data.id };
  });
}

export async function restoreRecordAction(input: unknown) {
  return serviceAction({ name: "restoreRecord", schema: tableInput }, input, async (ctx, data) => {
    await restoreRecord(ctx, data.table, data.id);
    refresh(PATHS[data.table], `${PATHS[data.table]}/${data.id}`, "/pipeline");
    return { id: data.id };
  });
}

export async function deleteRecordAction(input: unknown) {
  return serviceAction({ name: "deleteRecord", schema: tableInput }, input, async (ctx, data) => {
    await hardDeleteRecord(ctx, data.table, data.id);
    refresh(PATHS[data.table], "/pipeline");
    return { id: data.id };
  });
}

// --- Search ----------------------------------------------------------------

export async function searchAction(input: unknown) {
  return serviceAction({ name: "search", schema: searchInput, readOnly: true, bucket: "search" }, input, (ctx, data) => globalSearch(ctx, data.q));
}


/** CSV import of companies or contacts: dry_run validates and reports; the real run creates the rows. */
export async function importCsvAction(input: unknown) {
  return serviceAction({ name: "importCsv", schema: importInput, bucket: "create" }, input, async (ctx, data) => {
    const result = await importCsv(ctx, data);
    if (!data.dry_run) revalidatePath(data.entity === "companies" ? "/companies" : "/contacts");
    return result;
  });
}
