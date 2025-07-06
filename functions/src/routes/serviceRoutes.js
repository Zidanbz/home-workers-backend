const express = require('express');
const router = express.Router();
const { createService, getAllApprovedServices, getMyServices, getServiceById, addPhotoToService, updateService, deleteService, getServicesByCategory} = require('../controllers/serviceController');
const { authMiddleware } = require('../middlewares/authMiddleware');



// Endpoint publik untuk marketplace customer
router.get('/', getAllApprovedServices);

// Endpoint untuk worker membuat layanan baru
router.post('/', authMiddleware, createService);

// Endpoint untuk worker melihat daftar layanannya sendiri (perlu login)
router.get('/my-services', authMiddleware, getMyServices);

// Endpoint publik untuk melihat detail satu layanan
router.get('/:serviceId', getServiceById);

// Endpoint untuk worker menambahkan foto ke layanannya
router.post('/:serviceId/photos', authMiddleware, addPhotoToService);

// Endpoint untuk worker memperbarui layanannya
router.put('/:serviceId', authMiddleware, updateService);

// Endpoint untuk worker menghapus layanannya
router.delete('/:serviceId', authMiddleware, deleteService);

// Endpoint publik untuk melihat layanan berdasarkan kategori
router.get('/category/:categoryName', getServicesByCategory);
module.exports = router;