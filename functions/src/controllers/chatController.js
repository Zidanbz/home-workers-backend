const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * POST /api/chats
 * Memulai ruang obrolan baru dengan pengguna lain.
 */
const createChat = async (req, res) => {
  const { uid: senderId } = req.user;
  const { recipientId } = req.body;

  if (!recipientId) {
    return sendError(res, 400, 'Recipient ID is required.');
  }
  if (senderId === recipientId) {
    return sendError(res, 400, 'Cannot create a chat with yourself.');
  }

  try {
    const members = [senderId, recipientId].sort();
    const chatId = members.join('_');

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (chatDoc.exists) {
      return sendSuccess(res, 200, 'Chat already exists.', { chatId });
    }

    const senderDoc = await db.collection('users').doc(senderId).get();
    const recipientDoc = await db.collection('users').doc(recipientId).get();

    if (!senderDoc.exists || !recipientDoc.exists) {
      return sendError(res, 404, 'One or more users not found.');
    }

    const chatData = {
      members,
      memberInfo: {
        [senderId]: {
          nama: senderDoc.data().nama,
          avatarUrl: senderDoc.data().avatarUrl || '',
        },
        [recipientId]: {
          nama: recipientDoc.data().nama,
          avatarUrl: recipientDoc.data().avatarUrl || '',
        }
      },
      lastMessage: null,
      lastMessageTimestamp: null,
      unreadCount: {
        [senderId]: 0,
        [recipientId]: 0,
      },
      createdAt: new Date(),
    };

    await chatRef.set(chatData);

    return sendSuccess(res, 201, 'Chat created successfully.', { chatId });
  } catch (error) {
    return sendError(res, 500, 'Failed to create chat', error.message);
  }
};

/**
 * GET /api/chats
 */
const getMyChats = async (req, res) => {
  const { uid } = req.user;

  try {
    const chatsQuery = db.collection('chats').where('members', 'array-contains', uid);
    const snapshot = await chatsQuery.get();

    const chats = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return sendSuccess(res, 200, 'Chats retrieved successfully.', chats);
  } catch (error) {
    return sendError(res, 500, 'Failed to get chats', error.message);
  }
};

/**
 * POST /api/chats/:chatId/messages
 */
const sendMessage = async (req, res) => {
  const { uid: senderId } = req.user;
  const { chatId } = req.params;
  const { text } = req.body;

  if (!text) {
    return sendError(res, 400, 'Message text is required.');
  }

  try {
    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      return sendError(res, 404, 'Chat not found.');
    }

    const timestamp = new Date();
    const messagesRef = chatRef.collection('messages');
    await messagesRef.add({ senderId, text, timestamp });

    const { members, memberInfo } = chatDoc.data();
    const senderInfo = memberInfo[senderId];
    const recipientId = members.find(id => id !== senderId);
    const unreadCountUpdate = {};

    if (recipientId) {
      unreadCountUpdate[`unreadCount.${recipientId}`] = admin.firestore.FieldValue.increment(1);

      const recipientUserDoc = await db.collection('users').doc(recipientId).get();
      const fcmToken = recipientUserDoc.data().fcmToken;

      if (fcmToken) {
        const payload = {
          notification: {
            title: `Pesan baru dari ${senderInfo.nama}`,
            body: text,
          },
          token: fcmToken,
          data: { chatId }
        };

        await admin.messaging().send(payload);
        console.log('Notifikasi berhasil dikirim ke:', recipientId);
      }
    }

    await chatRef.update({
      lastMessage: text,
      lastMessageTimestamp: timestamp,
      ...unreadCountUpdate
    });

    return sendSuccess(res, 201, 'Message sent successfully.');
  } catch (error) {
    console.error("Error sending message or notification:", error);
    return sendError(res, 500, 'Failed to send message', error.message);
  }
};

/**
 * GET /api/chats/:chatId/messages
 */
const getMessages = async (req, res) => {
  const { chatId } = req.params;

  try {
    const messagesQuery = db.collection('chats').doc(chatId).collection('messages').orderBy('timestamp', 'asc');
    const snapshot = await messagesQuery.get();

    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return sendSuccess(res, 200, 'Messages retrieved successfully.', messages);
  } catch (error) {
    return sendError(res, 500, 'Failed to get messages', error.message);
  }
};

/**
 * POST /api/chats/:chatId/read
 */
const markChatAsRead = async (req, res) => {
  const { uid: currentUserId } = req.user;
  const { chatId } = req.params;

  try {
    const chatRef = db.collection('chats').doc(chatId);
    await chatRef.update({ [`unreadCount.${currentUserId}`]: 0 });
    return sendSuccess(res, 200, 'Chat marked as read.');
  } catch (error) {
    return sendError(res, 500, 'Failed to mark chat as read', error.message);
  }
};

module.exports = {
  createChat,
  getMyChats,
  sendMessage,
  getMessages,
  markChatAsRead,
};