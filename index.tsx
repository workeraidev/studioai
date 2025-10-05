/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {GoogleGenAI, Modality, Chat} from '@google/genai';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

// --- Type Definitions ---
interface GalleryItem {
  id: number;
  type: 'generate' | 'edit';
  imageData: string;
  prompt: string;
  originalImage?: string; // For edits
}

// --- State Management ---
let activeTab = 'generate';
let editState = {uploadedFile: null as File | null};
let analyzeState = {
  uploadedFile: null as File | null,
  chat: null as Chat | null,
  history: [] as {role: 'user' | 'model'; parts: string}[],
};
let gallery: GalleryItem[] = [];

// --- DOM Element References ---
const sidebar = {
  tabs: document.querySelectorAll('.tab-btn'),
  controlPanels: document.querySelectorAll('.controls-panel'),
};

const mainContent = {
  outputPanels: document.querySelectorAll('.output-panel'),
};

const generateTab = {
  controls: document.getElementById('generate-controls')!,
  prompt: document.getElementById('generate-prompt') as HTMLTextAreaElement,
  negativePrompt: document.getElementById(
    'negative-prompt',
  ) as HTMLTextAreaElement,
  aspectRatio: document.getElementById(
    'aspect-ratio-select',
  ) as HTMLSelectElement,
  numImages: document.getElementById('num-images-select') as HTMLSelectElement,
  button: document.getElementById('generate-btn') as HTMLButtonElement,
  output: document.getElementById('generate-output') as HTMLDivElement,
};

const editTab = {
  controls: document.getElementById('edit-controls')!,
  dropzone: document.getElementById('edit-image-dropzone') as HTMLDivElement,
  upload: document.getElementById('edit-image-upload') as HTMLInputElement,
  prompt: document.getElementById('edit-prompt') as HTMLTextAreaElement,
  button: document.getElementById('edit-btn') as HTMLButtonElement,
  output: document.getElementById('edit-output') as HTMLDivElement,
};

const analyzeTab = {
  controls: document.getElementById('analyze-controls')!,
  dropzone: document.getElementById(
    'analyze-image-dropzone',
  ) as HTMLDivElement,
  upload: document.getElementById('analyze-image-upload') as HTMLInputElement,
  instructions: document.getElementById('analyze-instructions')!,
  output: document.getElementById('analyze-output') as HTMLDivElement,
  chatContainer: document.getElementById('analyze-chat-container')!,
  imagePreview: document.getElementById('analyze-image-preview')!,
  messages: document.getElementById('chat-messages')!,
  form: document.getElementById('chat-form') as HTMLFormElement,
  input: document.getElementById('chat-input') as HTMLInputElement,
  sendBtn: document.getElementById('chat-send-btn') as HTMLButtonElement,
};

const galleryTab = {
  controls: document.getElementById('gallery-controls')!,
  output: document.getElementById('gallery-output') as HTMLDivElement,
  modal: document.getElementById('gallery-modal') as HTMLDivElement,
  modalImage: document.getElementById('modal-image') as HTMLImageElement,
  modalPrompt: document.getElementById('modal-prompt')!,
  modalCopyBtn: document.getElementById('modal-copy-btn') as HTMLButtonElement,
  modalDeleteBtn: document.getElementById('modal-delete-btn') as HTMLButtonElement,
  modalCloseBtn: document.getElementById('modal-close-btn') as HTMLButtonElement,
  currentViewingId: null as number | null,
};

// --- Utility Functions ---

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function showLoading(element: HTMLElement, text: string) {
  element.innerHTML = `
    <div class="loading-overlay">
      <div class="loader"></div>
      <p>${text}</p>
    </div>`;
}

function setupDropzone(
  dropzone: HTMLElement,
  input: HTMLInputElement,
  onFileSelect: (file: File) => void,
) {
  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragging');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
    if (e.dataTransfer?.files?.[0]) {
      onFileSelect(e.dataTransfer.files[0]);
      input.value = ''; // Reset file input
    }
  });
  input.addEventListener('change', () => {
    if (input.files?.[0]) {
      onFileSelect(input.files[0]);
      input.value = ''; // Reset file input
    }
  });
}

function showError(element: HTMLElement, message: string) {
  element.innerHTML = `<div class="error-message">${message}</div>`;
}

// --- Tab Switching Logic ---
sidebar.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const targetTab = tab.getAttribute('data-tab');
    if (!targetTab) return;
    activeTab = targetTab;

    sidebar.tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    sidebar.controlPanels.forEach((panel) => {
      panel.id === `${targetTab}-controls`
        ? panel.classList.add('active')
        : panel.classList.remove('active');
    });

    mainContent.outputPanels.forEach((panel) => {
      panel.id === `${targetTab}-output`
        ? panel.classList.add('active')
        : panel.classList.remove('active');
    });

    if (targetTab === 'gallery') {
      renderGallery();
    }
  });
});

// --- Gallery Logic ---
function loadGallery() {
  const storedGallery = localStorage.getItem('ai-image-studio-gallery');
  if (storedGallery) {
    gallery = JSON.parse(storedGallery);
  }
}

function saveGallery() {
  localStorage.setItem('ai-image-studio-gallery', JSON.stringify(gallery));
}

function addToGallery(item: Omit<GalleryItem, 'id'>) {
  const newItem = {...item, id: Date.now()};
  gallery.unshift(newItem);
  saveGallery();
}

function renderGallery() {
  galleryTab.output.innerHTML = '';
  if (gallery.length === 0) {
    galleryTab.output.innerHTML = `<div class="placeholder" style="grid-column: 1 / -1;"><h3>Empty Gallery</h3><p>Generated and edited images will appear here.</p></div>`;
    return;
  }
  gallery.forEach((item) => {
    const galleryItem = document.createElement('div');
    galleryItem.className = 'gallery-item';
    galleryItem.dataset.id = item.id.toString();
    galleryItem.innerHTML = `<img src="${item.imageData}" alt="${item.prompt}">`;
    galleryItem.addEventListener('click', () => openGalleryModal(item.id));
    galleryTab.output.appendChild(galleryItem);
  });
}

function openGalleryModal(id: number) {
  const item = gallery.find(i => i.id === id);
  if (!item) return;
  galleryTab.currentViewingId = id;
  galleryTab.modalImage.src = item.imageData;
  galleryTab.modalPrompt.textContent = item.prompt;
  galleryTab.modal.classList.remove('hidden');
}

function closeGalleryModal() {
  galleryTab.modal.classList.add('hidden');
  galleryTab.currentViewingId = null;
}

// --- Core API Functions ---

async function handleGenerateImage() {
  const prompt = generateTab.prompt.value;
  if (!prompt) {
    alert('Please enter a prompt.');
    return;
  }

  showLoading(generateTab.output, 'Generating your masterpiece...');
  generateTab.button.disabled = true;

  const fullPrompt = generateTab.negativePrompt.value
    ? `${prompt} --no ${generateTab.negativePrompt.value}`
    : prompt;

  try {
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: fullPrompt,
      config: {
        numberOfImages: parseInt(generateTab.numImages.value, 10),
        outputMimeType: 'image/jpeg',
        aspectRatio: generateTab.aspectRatio.value as '1:1',
      },
    });

    generateTab.output.innerHTML = '<div class="image-grid"></div>';
    const grid = generateTab.output.querySelector('.image-grid')!;

    const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

    response.generatedImages.forEach((genImage) => {
      const base64ImageBytes = genImage.image.imageBytes;
      const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
      grid.innerHTML += `
          <div class="image-container">
            <img src="${imageUrl}" alt="Generated image: ${prompt}">
            <a href="${imageUrl}" download="generated-${Date.now()}.jpeg" class="download-btn">
              ${downloadIcon}
              <span>Save</span>
            </a>
          </div>
        `;
      addToGallery({type: 'generate', imageData: imageUrl, prompt: prompt});
    });
  } catch (error) {
    console.error(error);
    showError(
      generateTab.output,
      'Error generating image. Please check the console for details.',
    );
  } finally {
    generateTab.button.disabled = false;
  }
}

async function handleEditImage() {
  const prompt = editTab.prompt.value;
  if (!prompt || !editState.uploadedFile) {
    alert('Please upload an image and enter an editing prompt.');
    return;
  }

  showLoading(editTab.output, 'Applying magical edits...');
  editTab.button.disabled = true;

  try {
    const base64ImageData = await fileToBase64(editState.uploadedFile);
    const mimeType = editState.uploadedFile.type;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {inlineData: {data: base64ImageData, mimeType}},
          {text: prompt},
        ],
      },
      config: {responseModalities: [Modality.IMAGE, Modality.TEXT]},
    });

    const editedImagePart = response.candidates?.[0]?.content.parts.find(
      (p) => p.inlineData,
    );

    if (editedImagePart?.inlineData) {
      const base64ImageBytes = editedImagePart.inlineData.data;
      const editedMimeType = editedImagePart.inlineData.mimeType;
      const editedImageUrl = `data:${editedMimeType};base64,${base64ImageBytes}`;
      const originalImageUrl = URL.createObjectURL(editState.uploadedFile);
      const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

      editTab.output.innerHTML = `
          <div class="comparison-grid">
            <div class="image-container">
              <h3>Original</h3>
              <img src="${originalImageUrl}" alt="Original image">
            </div>
            <div class="image-container">
              <h3>Edited</h3>
              <img src="${editedImageUrl}" alt="Edited image: ${prompt}">
              <a href="${editedImageUrl}" download="edited-${Date.now()}.png" class="download-btn">
                ${downloadIcon}
                <span>Save</span>
              </a>
            </div>
          </div>
        `;

      addToGallery({
        type: 'edit',
        imageData: editedImageUrl,
        prompt: prompt,
        originalImage: originalImageUrl,
      });
    } else {
      throw new Error('No image was returned from the edit request.');
    }
  } catch (error) {
    console.error(error);
    showError(
      editTab.output,
      'Error editing image. Please check the console for details.',
    );
  } finally {
    editTab.button.disabled = false;
  }
}

async function handleAnalyzeImageUpload(file: File) {
  analyzeState = {uploadedFile: file, chat: null, history: []}; // Reset
  analyzeTab.chatContainer.classList.remove('hidden');
  analyzeTab.output.querySelector('.placeholder')?.classList.add('hidden');
  analyzeTab.instructions.classList.remove('hidden');

  const imageUrl = URL.createObjectURL(file);
  analyzeTab.imagePreview.innerHTML = `<img src="${imageUrl}" alt="Image for analysis">`;
  analyzeTab.messages.innerHTML = '';
  analyzeTab.input.value = '';
  analyzeTab.input.disabled = true;
  analyzeTab.sendBtn.disabled = true;

  try {
    const base64ImageData = await fileToBase64(file);
    const mimeType = file.type;

    analyzeState.chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      history: [{role: 'user', parts: [{inlineData: {data: base64ImageData, mimeType}}, {text: 'This is the image we will be discussing. Please confirm you see it by responding with "OK".'}]}],
    });
    
    // Initial message to prime the chat
    const response = await analyzeState.chat.sendMessage({message: ' '});
    
    // Don't display priming messages
    analyzeTab.input.disabled = false;
    analyzeTab.sendBtn.disabled = false;
    analyzeTab.input.focus();

  } catch(error) {
     console.error(error);
    showError(
      analyzeTab.messages,
      'Could not start analysis session. Please try again.',
    );
  }
}


async function handleAnalyzeChat(e: Event) {
    e.preventDefault();
    const prompt = analyzeTab.input.value.trim();
    if (!prompt || !analyzeState.chat) return;

    analyzeTab.input.value = '';
    analyzeTab.input.disabled = true;
    analyzeTab.sendBtn.disabled = true;

    // Display user message
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'chat-message user';
    userMsgEl.innerHTML = `<p>${prompt}</p>`;
    analyzeTab.messages.appendChild(userMsgEl);
    analyzeTab.messages.scrollTop = analyzeTab.messages.scrollHeight;

    // Display model loading state
    const modelMsgEl = document.createElement('div');
    modelMsgEl.className = 'chat-message model';
    modelMsgEl.innerHTML = `<p class="loading-dots"><span>.</span><span>.</span><span>.</span></p>`;
    analyzeTab.messages.appendChild(modelMsgEl);
    analyzeTab.messages.scrollTop = analyzeTab.messages.scrollHeight;


    try {
        const response = await analyzeState.chat.sendMessage({message: prompt});
        const analysisText = response.text;
        
        modelMsgEl.innerHTML = `<p>${analysisText.replace(/\n/g, '<br>')}</p>`;

    } catch(error) {
        console.error(error);
        modelMsgEl.innerHTML = `<p class="error">Sorry, I couldn't respond. Please try again.</p>`;
    } finally {
        analyzeTab.input.disabled = false;
        analyzeTab.sendBtn.disabled = false;
        analyzeTab.input.focus();
        analyzeTab.messages.scrollTop = analyzeTab.messages.scrollHeight;
    }
}


// --- Event Listeners ---

// Generate Tab
generateTab.button.addEventListener('click', handleGenerateImage);

// Edit Tab
setupDropzone(editTab.dropzone, editTab.upload, (file) => {
  editState.uploadedFile = file;
  const imageUrl = URL.createObjectURL(file);
  editTab.dropzone.innerHTML = `<img src="${imageUrl}" class="preview-img" alt="Uploaded preview"><p>${file.name}</p>`;
  editTab.prompt.disabled = false;
  editTab.button.disabled = false;
  editTab.output.innerHTML = `<div class="placeholder"><h3>Original Image</h3><p>Describe the edits you'd like to make in the sidebar.</p></div>`;
});
editTab.button.addEventListener('click', handleEditImage);

// Analyze Tab
setupDropzone(analyzeTab.dropzone, analyzeTab.upload, handleAnalyzeImageUpload);
analyzeTab.form.addEventListener('submit', handleAnalyzeChat);


// Gallery Modal
galleryTab.modalCloseBtn.addEventListener('click', closeGalleryModal);
galleryTab.modal.addEventListener('click', (e) => {
    if (e.target === galleryTab.modal) closeGalleryModal();
});
galleryTab.modalCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(galleryTab.modalPrompt.textContent || '');
    galleryTab.modalCopyBtn.textContent = 'Copied!';
    setTimeout(() => { galleryTab.modalCopyBtn.textContent = 'Copy Prompt';}, 2000);
});
galleryTab.modalDeleteBtn.addEventListener('click', () => {
    if (galleryTab.currentViewingId && confirm('Are you sure you want to delete this image?')) {
        gallery = gallery.filter(item => item.id !== galleryTab.currentViewingId);
        saveGallery();
        closeGalleryModal();
        renderGallery();
    }
});


// --- Initialization ---
loadGallery();
document.addEventListener('DOMContentLoaded', () => {
  sidebar.tabs[0].dispatchEvent(new MouseEvent('click'));
});