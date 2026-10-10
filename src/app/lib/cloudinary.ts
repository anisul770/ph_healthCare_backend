import { v2 as Cloudinary } from 'cloudinary';
import config from '../config';

// Configuration
Cloudinary.config({ 
    api_secret: config.cloudinary_api_secret, // Click 'View API Keys' above to copy your API secret
    cloud_name: config.cloudinary_cloud_name, 
    api_key: config.cloudinary_api_key, 
});

export const cloudinary = Cloudinary;