const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');

class ModelHandler {
    constructor() {
        this.model = null;
        this.initialized = false;
    }

    async loadModel() {
        try {

            this.model = tf.sequential();
            
            this.model.add(tf.layers.dense({
                inputShape: [2003],
                units: 512,
                activation: 'relu'
            }));
            
            this.model.add(tf.layers.dropout({ rate: 0.3 }));
            
            this.model.add(tf.layers.dense({
                units: 256,
                activation: 'relu'
            }));
            
            this.model.add(tf.layers.dropout({ rate: 0.2 }));
            
            this.model.add(tf.layers.dense({
                units: 567,
                activation: 'softmax'
            }));

            this.model.compile({
                optimizer: 'adam',
                loss: 'categoricalCrossentropy',
                metrics: ['accuracy']
            });

            this.initialized = true;
            console.log('✅ Model created and initialized successfully');
        } catch (error) {
            console.error('❌ Error loading model:', error);
            throw error;
        }
    }

    async getRecommendations(userProfile) {
        if (!this.initialized) {
            throw new Error('Model not initialized');
        }

        try {
            console.log('Creating tensor from user profile');
            const inputTensor = tf.tensor2d([userProfile]);
            
            console.log('Getting predictions from model');

            const predictions = await this.model.predict(inputTensor);
            const predictionData = await predictions.data();
            
            console.log('Processing prediction data');
            const topK = 20; 
            const indices = Array.from(predictionData)
                .map((prob, index) => ({ prob, index }))
                .sort((a, b) => b.prob - a.prob)
                .slice(0, topK)
                .map(item => item.index);

            console.log('Top prediction indices:', indices);

            // Cleanup
            inputTensor.dispose();
            predictions.dispose();

            return indices;
        } catch (error) {
            console.error('Error making predictions:', error);
            throw error;
        }
    }

    preprocessUserProfile(savedBooks) {
        console.log('Preprocessing user profile from saved books:', savedBooks.length);
        
        const profile = new Array(2003).fill(0);
        
        const booksWithoutIndices = [];
        
        // Update profile based on saved books
        savedBooks.forEach(book => {
            if (typeof book.bookIndex === 'number') {
                console.log('Processing book with index:', book.bookIndex);
                profile[book.bookIndex] = 1;
            } else {
                booksWithoutIndices.push(book.title);
            }

            // Process categories
            if (book.categories) {
                const categories = Array.isArray(book.categories) 
                    ? book.categories 
                    : book.categories.split(',').map(c => c.trim());
                
                categories.forEach(category => {
                    const categoryIndex = this.getCategoryIndex(category);
                    if (categoryIndex !== -1) {
                        profile[categoryIndex] = 1;
                    }
                });
            }
        });

        if (booksWithoutIndices.length > 0) {
            console.warn('Books without indices:', booksWithoutIndices);
        }

        const activeFeatures = profile.filter(v => v > 0).length;
        console.log('Profile created with active features:', activeFeatures);
        
        if (activeFeatures === 0) {
            console.warn('No active features in user profile. Check if books have proper indices and categories.');
        }

        return profile;
    }

    getCategoryIndex(category) {
        const categoryMap = {
            'Fiction': 1000,
            'Non-fiction': 1001,
            'Science': 1002,
            'Technology': 1003,
            'Business': 1004,
            'Self-help': 1005,
            'Biography': 1006,
            'History': 1007,
            'Mystery': 1008,
            'Romance': 1009,
            'Science Fiction': 1010,
            'Fantasy': 1011,
            'Horror': 1012,
            'Thriller': 1013,
            'Children': 1014,
            'Young Adult': 1015,
            'Poetry': 1016,
            'Drama': 1017,
            'Art': 1018,
            'Music': 1019,
            'Travel': 1020,
            'Cooking': 1021,
            'Health': 1022,
            'Religion': 1023,
            'Philosophy': 1024
        };

        if (categoryMap[category]) {
            return categoryMap[category];
        }

        const lowerCategory = category.toLowerCase();
        const match = Object.entries(categoryMap).find(([key]) => 
            key.toLowerCase() === lowerCategory
        );

        return match ? match[1] : -1;
    }
}

module.exports = new ModelHandler(); 