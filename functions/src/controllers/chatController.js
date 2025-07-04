const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * POST /api/chats
 * Memulai ruang obrolan baru dengan pengguna lain.
 */
const createChat = async (req, res) => {
    const { uid: senderId } = req.user; // Pengguna yang memulai chat
    const { recipientId } = req.body;   // Pengguna yang diajak chat

    if (!recipientId) {
        return res.status(400).json({ message: 'Recipient ID is required.' });
    }
    if (senderId === recipientId) {
        return res.status(400).json({ message: 'Cannot create a chat with yourself.' });
    }

    try {
        // Buat ID chat yang konsisten untuk 2 pengguna, urutkan berdasarkan abjad
        const members = [senderId, recipientId].sort();
        const chatId = members.join('_');
        
        const chatRef = db.collection('chats').doc(chatId);
        const chatDoc = await chatRef.get();

        // Jika chat sudah ada, kembalikan ID yang sudah ada
        if (chatDoc.exists) {
            return res.status(200).json({ message: 'Chat already exists.', chatId: chatId });
        }

        // Jika belum ada, buat chat baru
        // Ambil data profil kedua pengguna untuk disimpan di dokumen chat
        const senderDoc = await db.collection('users').doc(senderId).get();
        const recipientDoc = await db.collection('users').doc(recipientId).get();

        if (!senderDoc.exists || !recipientDoc.exists) {
            return res.status(404).json({ message: 'One or more users not found.' });
        }

        const chatData = {
            members: members,
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

        res.status(201).json({ message: 'Chat created successfully.', chatId: chatId });

    } catch (error) {
        res.status(500).json({ message: 'Failed to create chat', error: error.message });
    }
};

/**
 * GET /api/chats
 * Mengambil daftar semua ruang obrolan milik pengguna yang sedang login.
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

        res.status(200).json(chats);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get chats', error: error.message });
    }
};

/**
 * POST /api/chats/:chatId/messages
 * Mengirim pesan baru DAN mengirim notifikasi push ke penerima.
 */
const sendMessage = async (req, res) => {
    const { uid: senderId } = req.user;
    const { chatId } = req.params;
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ message: 'Message text is required.' });
    }

    try {
        const chatRef = db.collection('chats').doc(chatId);
        const messagesRef = chatRef.collection('messages');
        // const timestamp = new Date();

        // Operasi 1 & 2: Simpan pesan dan update chat (tidak berubah)
        await messagesRef.add({ senderId, text, timestamp });
        await chatRef.update({ lastMessage: text, lastMessageTimestamp: timestamp });

        // --- LANGKAH BARU: Kirim Notifikasi ---
        
        // Dapatkan info anggota chat
        const chatDoc = await chatRef.get();
        const members = chatDoc.data().members;
        const senderInfo = chatDoc.data().memberInfo[senderId];
        
        // Cari ID penerima
        const recipientId = members.find(id => id !== senderId);
        const unreadCountUpdate = {};

        if (recipientId) {
            // Ambil token perangkat penerima dari profil user mereka
            const recipientUserDoc = await db.collection('users').doc(recipientId).get();
            const fcmToken = recipientUserDoc.data().fcmToken;
            unreadCountUpdate[`unreadCount.${recipientId}`] = admin.firestore.FieldValue.increment(1);
            if (fcmToken) {
                // Buat payload notifikasi
                const payload = {
                    notification: {
                        title: `Pesan baru dari ${senderInfo.nama}`,
                        body: text,
                    },
                    token: fcmToken,
                    // Anda bisa menambahkan data lain di sini untuk ditangani oleh aplikasi
                    data: {
                        chatId: chatId,
                    }
                };

                // Kirim notifikasi menggunakan Firebase Admin SDK
                await admin.messaging().send(payload);
                console.log('Notifikasi berhasil dikirim ke:', recipientId);
            }


        }
        const timestamp = new Date();
        await db.collection('chats').doc(chatId).collection('messages').add({ senderId, text, timestamp });
        await chatRef.update({ 
            lastMessage: text, 
            lastMessageTimestamp: timestamp,
            ...unreadCountUpdate // Tambahkan update unread count
        });

        // --- AKHIR LANGKAH BARU ---

        res.status(201).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error("Error sending message or notification:", error);
        res.status(500).json({ message: 'Failed to send message', error: error.message });
    }
};

/**
 * GET /api/chats/:chatId/messages
 * Mengambil semua pesan dari sebuah ruang obrolan.
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

        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get messages', error: error.message });
    }
};

/**
 * POST /api/chats/:chatId/read
 * Mereset unread count untuk pengguna yang sedang login.
 */
const markChatAsRead = async (req, res) => {
    const { uid: currentUserId } = req.user;
    const { chatId } = req.params;

    try {
        const chatRef = db.collection('chats').doc(chatId);
        
        // Update field unread count untuk user ini menjadi 0
        await chatRef.update({
            [`unreadCount.${currentUserId}`]: 0
        });

        res.status(200).json({ message: 'Chat marked as read.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to mark chat as read', error: error.message });
    }
};

module.exports = {
    createChat,
    getMyChats,
    sendMessage,
    getMessages,
    markChatAsRead,
};