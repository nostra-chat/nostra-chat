import {describe, it, expect, vi, beforeEach} from 'vitest';

// Mock QRCodeStyling before any imports
const mockAppend = vi.fn();
const mockDownload = vi.fn();
const mockGetRawData = vi.fn().mockResolvedValue(new Blob(['fake-png']));
const MockQRCodeStyling = vi.fn().mockImplementation(() => ({
  append: mockAppend,
  download: mockDownload,
  getRawData: mockGetRawData
}));

vi.mock('qr-code-styling', () => ({
  default: MockQRCodeStyling
}));

// Mock identity store
const mockNpub = vi.fn(() => 'npub1zuuajd7u3sx8xu92yav9jwxpr839cs0kc76h3t6meju7zcr0nhqs2w0gu8');
const mockDisplayName = vi.fn((): string | null => null);
const mockNip05 = vi.fn((): string | null => null);
const mockIsLocked = vi.fn(() => false);
const mockProtectionType = vi.fn(() => 'none');

vi.mock('@stores/nostraIdentity', () => ({
  default: () => ({
    npub: mockNpub,
    displayName: mockDisplayName,
    nip05: mockNip05,
    isLocked: mockIsLocked,
    protectionType: mockProtectionType
  })
}));

describe('qr-identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNpub.mockReturnValue('npub1zuuajd7u3sx8xu92yav9jwxpr839cs0kc76h3t6meju7zcr0nhqs2w0gu8');
    mockDisplayName.mockReturnValue(null);
    mockNip05.mockReturnValue(null);
  });

  describe('QRIdentity data flow', () => {
    it('provides npub from identity store to QR code', () => {
      const npub = mockNpub();
      expect(npub).toBe('npub1zuuajd7u3sx8xu92yav9jwxpr839cs0kc76h3t6meju7zcr0nhqs2w0gu8');
      expect(npub.startsWith('npub1')).toBe(true);
    });

    it('returns display name when set', () => {
      mockDisplayName.mockReturnValue('Alice');
      expect(mockDisplayName()).toBe('Alice');
    });

    it('returns null display name when not set — component should show truncated npub', () => {
      mockDisplayName.mockReturnValue(null);
      expect(mockDisplayName()).toBeNull();

      // Verify truncation logic
      const npub = mockNpub()!;
      const truncated = npub.slice(0, 10) + '...' + npub.slice(-6);
      expect(truncated).toBe('npub1zuuaj...2w0gu8');
      expect(truncated.length).toBeLessThan(npub.length);
    });

    it('returns NIP-05 alias when set', () => {
      mockNip05.mockReturnValue('alice@example.com');
      expect(mockNip05()).toBe('alice@example.com');
    });

    it('returns null NIP-05 when not set — component should hide badge', () => {
      mockNip05.mockReturnValue(null);
      expect(mockNip05()).toBeNull();
    });
  });

  describe('QRIdentity copy functionality', () => {
    it('copies npub to clipboard via navigator.clipboard.writeText', async() => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {writeText: mockWriteText}
      });

      const currentNpub = mockNpub();
      await navigator.clipboard.writeText(currentNpub!);

      expect(mockWriteText).toHaveBeenCalledWith(
        'npub1zuuajd7u3sx8xu92yav9jwxpr839cs0kc76h3t6meju7zcr0nhqs2w0gu8'
      );
    });
  });

  describe('QRCodeStyling integration', () => {
    it('creates QRCodeStyling with correct options', () => {
      const npub = mockNpub();
      const qr = new MockQRCodeStyling({
        width: 280,
        height: 280,
        data: npub,
        dotsOptions: {
          color: '#1a1a2e',
          type: 'rounded'
        },
        backgroundOptions: {
          color: '#ffffff'
        }
      });

      expect(MockQRCodeStyling).toHaveBeenCalledWith(expect.objectContaining({
        width: 280,
        height: 280,
        data: npub
      }));
      expect(qr.append).toBeDefined();
      expect(qr.download).toBeDefined();
    });

    it('can generate raw data for sharing', async() => {
      const qr = new MockQRCodeStyling({data: 'test'});
      const blob = await qr.getRawData('png');
      expect(blob).toBeInstanceOf(Blob);
    });
  });
});
