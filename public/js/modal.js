// Premium Modal System for GameHub
// Replaces alert, confirm, and showTransientMessage with premium modals

let modalQueue = [];
let currentModal = null;
let toastContainer = null;
let lastToastSignature = null;
let lastToastTimestamp = 0;

function getToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }
  toastContainer = document.createElement('div');
  toastContainer.id = 'premium-toast-container';
  toastContainer.className = 'fixed bottom-6 right-6 z-[9998] flex flex-col gap-3 w-[min(90vw,320px)] pointer-events-none';
  document.body.appendChild(toastContainer);
  return toastContainer;
}

// Premium Modal Component
function showPremiumModal(options = {}) {
  if (currentModal) {
    modalQueue.push(options);
    return;
  }
  const {
    title = 'Notification',
    message = '',
    type = 'info', // 'info', 'success', 'warning', 'error', 'confirm'
    duration = 0, // 0 = manual close, > 0 = auto close in ms
    onConfirm = null,
    onCancel = null,
    confirmText = 'OK',
    cancelText = 'Batal',
    showCancel = false
  } = options;

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'premium-modal';
  overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center';
  overlay.style.cssText = 'backdrop-filter: blur(4px); animation: fadeIn 0.2s ease-out forwards;';
  
  // Create modal container
  const modal = document.createElement('div');
  modal.className = 'relative bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl p-6 max-w-md w-[90vw]';
  modal.style.cssText = 'animation: slideUp 0.3s ease-out forwards; box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);';
  
  // Type-based styling
  const typeConfig = {
    info: { icon: 'ℹ️', color: 'blue', accent: 'bg-blue-500/10 border-blue-500/20' },
    success: { icon: '✅', color: 'green', accent: 'bg-green-500/10 border-green-500/20' },
    warning: { icon: '⚠️', color: 'yellow', accent: 'bg-yellow-500/10 border-yellow-500/20' },
    error: { icon: '❌', color: 'red', accent: 'bg-red-500/10 border-red-500/20' },
    confirm: { icon: '❓', color: 'purple', accent: 'bg-purple-500/10 border-purple-500/20' }
  };
  
  const config = typeConfig[type] || typeConfig.info;
  
  // Modal content
  modal.innerHTML = `
    <div class="flex items-start gap-4">
      <div class="flex-shrink-0 w-12 h-12 rounded-full ${config.accent} border flex items-center justify-center text-2xl">
        ${config.icon}
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-xl font-bold text-white mb-2">${escapeHtml(title)}</h3>
        <p class="text-gray-300 text-sm leading-relaxed">${escapeHtml(message)}</p>
      </div>
      ${type !== 'confirm' ? `
        <button id="modal-close" class="flex-shrink-0 w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      ` : ''}
    </div>
    <div class="flex justify-end gap-3 mt-6">
      ${showCancel || type === 'confirm' ? `
        <button id="modal-cancel" class="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition font-medium text-sm">
          ${cancelText}
        </button>
      ` : ''}
      <button id="modal-confirm" class="px-4 py-2 rounded-lg text-white font-medium text-sm transition shadow-lg hover:opacity-90">
        ${confirmText}
      </button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  currentModal = overlay;
  
  // Event handlers
  const closeModal = (result = false) => {
    if (!overlay || !overlay.parentNode || overlay._isClosing) return;
    overlay._isClosing = true;
    
    // Cleanup escape handler
    if (overlay._escapeHandler) {
      document.removeEventListener('keydown', overlay._escapeHandler);
      delete overlay._escapeHandler;
    }
    
    overlay.style.animation = 'fadeOut 0.2s ease-out forwards';
    modal.style.animation = 'slideDown 0.2s ease-out forwards';
    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.remove();
      }
      currentModal = null;
      // Process next modal in queue
      if (modalQueue.length > 0) {
        const next = modalQueue.shift();
        showPremiumModal(next);
      }
    }, 200);
    
    // Call callbacks asynchronously to prevent blocking
    setTimeout(() => {
      if (result && onConfirm) {
        try {
          onConfirm();
        } catch (e) {
          // Error in callback - non-critical
        }
      } else if (!result && onCancel) {
        try {
          onCancel();
        } catch (e) {
          // Error in callback - non-critical
        }
      }
    }, 0);
  };
  
  // Close button
  const closeBtn = modal.querySelector('#modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeModal(false));
  }
  
  // Cancel button
  const cancelBtn = modal.querySelector('#modal-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeModal(false));
  }
  
  // Confirm button
  const confirmBtn = modal.querySelector('#modal-confirm');
  if (confirmBtn) {
    // Set button colors based on type (inline styles for dynamic colors)
    const colors = {
      info: { from: '#2563eb', to: '#1d4ed8', shadow: 'rgba(37, 99, 235, 0.2)' },
      success: { from: '#16a34a', to: '#15803d', shadow: 'rgba(22, 163, 74, 0.2)' },
      warning: { from: '#ca8a04', to: '#a16207', shadow: 'rgba(202, 138, 4, 0.2)' },
      error: { from: '#dc2626', to: '#b91c1c', shadow: 'rgba(220, 38, 38, 0.2)' },
      confirm: { from: '#9333ea', to: '#7e22ce', shadow: 'rgba(147, 51, 234, 0.2)' }
    };
    const btnColor = colors[type] || colors.info;
    confirmBtn.style.background = `linear-gradient(to right, ${btnColor.from}, ${btnColor.to})`;
    confirmBtn.style.boxShadow = `0 10px 15px -3px ${btnColor.shadow}`;
    
    confirmBtn.addEventListener('click', () => closeModal(true));
  }
  
  // Click outside to close (only for non-confirm modals)
  if (type !== 'confirm') {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(false);
      }
    });
  }
  
  // Auto close if duration specified
  if (duration > 0) {
    setTimeout(() => {
      closeModal(false);
    }, duration);
  }
  
  // Escape key to close
  const escapeHandler = (e) => {
    if (e.key === 'Escape' && currentModal === overlay) {
      closeModal(false);
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
  
  // Store escape handler for cleanup
  overlay._escapeHandler = escapeHandler;
}

// Premium Alert (replaces window.alert)
function premiumAlert(message, title = 'Notification') {
  return new Promise((resolve) => {
    showPremiumModal({
      title,
      message,
      type: 'info',
      confirmText: 'OK',
      showCancel: false,
      onConfirm: () => resolve(true)
    });
  });
}

// Premium Confirm (replaces window.confirm)
function premiumConfirm(message, title = 'Konfirmasi') {
  return new Promise((resolve) => {
    showPremiumModal({
      title,
      message,
      type: 'confirm',
      confirmText: 'Ya',
      cancelText: 'Tidak',
      showCancel: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false)
    });
  });
}

// Premium Toast (replaces showTransientMessage)
// Changed: No longer auto-closes, user must click OK button
function showPremiumToast(message, duration = 0, type = 'info') {
  const signature = `${type}:${message}`;
  const now = Date.now();
  if (signature === lastToastSignature && now - lastToastTimestamp < 500) {
    return;
  }
  lastToastSignature = signature;
  lastToastTimestamp = now;

  const container = getToastContainer();

  const palette = {
    info: { border: 'border-blue-400/30', bg: 'bg-blue-500/10', accent: 'text-blue-300', icon: 'ℹ️' },
    success: { border: 'border-emerald-400/30', bg: 'bg-emerald-500/10', accent: 'text-emerald-300', icon: '✅' },
    warning: { border: 'border-amber-400/30', bg: 'bg-amber-500/10', accent: 'text-amber-300', icon: '⚠️' },
    error: { border: 'border-rose-400/30', bg: 'bg-rose-500/10', accent: 'text-rose-300', icon: '⚠️' }
  };
  const scheme = palette[type] || palette.info;

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto rounded-2xl border ${scheme.border} ${scheme.bg} backdrop-blur-md p-4 text-white shadow-[0_20px_40px_rgba(0,0,0,0.35)] opacity-0 translate-y-4 transition-all duration-200`;
  toast.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="text-2xl ${scheme.accent}">${scheme.icon}</div>
      <div class="flex-1">
        <p class="text-sm leading-relaxed text-white/80">${escapeHtml(message)}</p>
      </div>
      <button class="text-white/50 hover:text-white text-xs uppercase tracking-[0.3em]">OK</button>
    </div>
  `;

  const dismiss = () => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      toast.remove();
      if (toastContainer && toastContainer.children.length === 0) {
        toastContainer.remove();
        toastContainer = null;
      }
    }, 200);
  };

  toast.querySelector('button')?.addEventListener('click', dismiss);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('opacity-100', 'translate-y-0');
  });

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
}

// Helper: escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add CSS animations if not already added
if (!document.getElementById('premium-modal-styles')) {
  const style = document.createElement('style');
  style.id = 'premium-modal-styles';
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    @keyframes slideUp {
      from { transform: translateY(20px) scale(0.95); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    @keyframes slideDown {
      from { transform: translateY(0) scale(1); opacity: 1; }
      to { transform: translateY(20px) scale(0.95); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// Expose globally
window.showPremiumModal = showPremiumModal;
window.premiumAlert = premiumAlert;
window.premiumConfirm = premiumConfirm;
window.showPremiumToast = showPremiumToast;

// Replace window.alert and window.confirm
window.alert = premiumAlert;
window.confirm = premiumConfirm;

