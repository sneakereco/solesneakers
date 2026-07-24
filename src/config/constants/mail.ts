export const EMAIL_DISPLAY_NAME = "SOLESNEAKERS";

const shortOrderId = (orderId: string) => orderId.slice(0, 8);

// Preserve the currently verified sender identity while moving it out of env.
// When the Solesneakers sender address is verified, update these two values together.
export const MAIL_FROM_EMAIL = "info@shopsolesneakers.com";
export const MAIL_FROM_NAME = "Solesneakers";

export const SUPPORT_EMAIL = "Jmanrule15@gmail.com";
export const BUG_REPORT_EMAIL = "jrushinski@sneakereco.com";
export const MAIL_REPLY_TO_EMAIL = SUPPORT_EMAIL;

export const emailSubjects = {
  orderConfirmation: () => `Your ${EMAIL_DISPLAY_NAME} order is confirmed`,
  pickupInstructions: (orderId: string) =>
    `Local pickup instructions for order #${shortOrderId(orderId)}`,
  orderLabelCreated: (orderId: string) =>
    `Your ${EMAIL_DISPLAY_NAME} order #${shortOrderId(orderId)} label is created`,
  orderInTransit: (orderId: string) =>
    `Your ${EMAIL_DISPLAY_NAME} order #${shortOrderId(orderId)} is on the way`,
  orderDelivered: (orderId: string) =>
    `Your ${EMAIL_DISPLAY_NAME} order #${shortOrderId(orderId)} was delivered`,
  orderRefunded: (orderId: string) =>
    `Your ${EMAIL_DISPLAY_NAME} order #${shortOrderId(orderId)} has been refunded`,
  subscriptionConfirmed: () => `Thanks for subscribing to ${EMAIL_DISPLAY_NAME}`,
  subscriptionConfirmation: () => `Confirm your ${EMAIL_DISPLAY_NAME} subscription`,
  passwordUpdated: () => `Your ${EMAIL_DISPLAY_NAME} password was updated`,
};
