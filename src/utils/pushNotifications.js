const { Expo } = require('expo-server-sdk');

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

/**
 * Send a push notification via Expo Push Service
 * @param {string} pushToken - Expo push token
 * @param {Object} options - { title, body, data }
 */
const sendPushNotification = async (pushToken, { title, body, data = {} }) => {
  if (!pushToken) return;
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn(`Invalid Expo push token: ${pushToken}`);
    return;
  }

  try {
    const chunks = expo.chunkPushNotifications([
      {
        to: pushToken,
        sound: 'default',
        title,
        body,
        data,
        badge: 1,
        priority: 'high',
        channelId: 'messages',
      },
    ]);

    for (const chunk of chunks) {
      const results = await expo.sendPushNotificationsAsync(chunk);
      results.forEach((result) => {
        if (result.status === 'error') {
          console.error('Push notification error:', result.message);
        }
      });
    }
  } catch (error) {
    console.error('Push notification failed:', error.message);
  }
};

module.exports = { sendPushNotification };
