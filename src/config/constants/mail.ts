export const EMAIL_DISPLAY_NAME = "SOLESNEAKERS";

const shortOrderId = (orderId: string) => orderId.slice(0, 8);

// Use the SES-verified sender domain for transactional email.
export const MAIL_FROM_EMAIL = "info@solesneakersnc.com";
export const MAIL_FROM_NAME = "Solesneakers";

export const SUPPORT_EMAIL = "SolesneakersLLC@yahoo.com";
export const MAIL_REPLY_TO_EMAIL = SUPPORT_EMAIL;
export const RESELLER_ORDER_NOTIFICATION_EMAIL = "SolesneakersLLC@yahoo.com";

export const emailSubjects = {
  orderConfirmation: () => `Your ${EMAIL_DISPLAY_NAME} order is confirmed`,
  resellerOrderPlaced: (orderId: string) =>
    `New paid order #${shortOrderId(orderId)} | ${EMAIL_DISPLAY_NAME}`,
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
  passwordUpdated: () => `Your ${EMAIL_DISPLAY_NAME} password was updated`,
};
