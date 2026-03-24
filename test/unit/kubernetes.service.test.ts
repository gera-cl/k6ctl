import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, promises as fs_promises } from 'fs';
import * as k8s from '@kubernetes/client-node';
import logger from '../../src/utils/logger';
import { KubernetesService, createDefaultKubernetesService } from '../../src/services/kubernetes.service';
import type { ArchivedFile } from '../../src/types/kubernetes.types';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    stat: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('@kubernetes/client-node', () => {
  const mockApiClient = {
    createNamespacedConfigMap: jest.fn(),
    deleteNamespacedConfigMap: jest.fn(),
  };

  const mockLoadFromDefault = jest.fn();
  const mockSetCurrentContext = jest.fn();
  const mockMakeApiClient = jest.fn(() => mockApiClient);

  const KubeConfig = jest.fn().mockImplementation(() => ({
    loadFromDefault: mockLoadFromDefault,
    setCurrentContext: mockSetCurrentContext,
    makeApiClient: mockMakeApiClient,
  }));

  return {
    KubeConfig,
    CoreV1Api: jest.fn(),
    __mocks: {
      mockApiClient,
      mockLoadFromDefault,
      mockSetCurrentContext,
      mockMakeApiClient,
    },
  };
});

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedExistsSync = existsSync as unknown as jest.Mock;
const mockedStat = fs_promises.stat as unknown as jest.Mock;
const mockedReadFile = fs_promises.readFile as unknown as jest.Mock;
const mockedUnlink = fs_promises.unlink as unknown as jest.MockedFunction<typeof fs_promises.unlink>;
const mockedLoggerInfo = logger.info as unknown as jest.Mock;

const mockedK8sModule = k8s as unknown as {
  KubeConfig: jest.Mock;
  CoreV1Api: unknown;
  __mocks: {
    mockApiClient: {
      createNamespacedConfigMap: jest.Mock;
      deleteNamespacedConfigMap: jest.Mock;
    };
    mockLoadFromDefault: jest.Mock;
    mockSetCurrentContext: jest.Mock;
    mockMakeApiClient: jest.Mock;
  };
};

describe('KubernetesService', () => {
  let service: KubernetesService;
  let mockCoreV1Api: {
    createNamespacedConfigMap: jest.Mock;
    deleteNamespacedConfigMap: jest.Mock;
  };
  let mockCustomObjectsApi: {
    createNamespacedCustomObject: jest.Mock;
    deleteNamespacedCustomObject: jest.Mock;
  };

  const archiveFile: ArchivedFile = {
    archivePath: '/tmp/archive-script.tar',
    archiveFilename: 'archive-script.tar',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockCoreV1Api = {
      createNamespacedConfigMap: jest.fn(),
      deleteNamespacedConfigMap: jest.fn(),
    };
    mockCustomObjectsApi = {
      createNamespacedCustomObject: jest.fn(),
      deleteNamespacedCustomObject: jest.fn(),
    };

    service = new KubernetesService(mockCoreV1Api as unknown as k8s.CoreV1Api, mockCustomObjectsApi as unknown as k8s.CustomObjectsApi);
  });

  describe('createConfigMap', () => {
    test('throws when archive file does not exist', async () => {
      mockedExistsSync.mockReturnValue(false);

      await expect(service.createConfigMap(archiveFile, 'default'))
        .rejects.toThrow('Archive file not found at path: /tmp/archive-script.tar');

      expect(mockedStat).not.toHaveBeenCalled();
      expect(mockCoreV1Api.createNamespacedConfigMap).not.toHaveBeenCalled();
    });

    test('throws when archive file is larger than 1MB', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedStat.mockImplementation(async () => ({ size: 1024 * 1024 + 1 }));

      await expect(service.createConfigMap(archiveFile, 'default'))
        .rejects.toThrow('Archive file is too large to be stored in a configmap');

      expect(mockedReadFile).not.toHaveBeenCalled();
      expect(mockCoreV1Api.createNamespacedConfigMap).not.toHaveBeenCalled();
    });

    test('creates configmap with binaryData and returns namespace/name', async () => {
      mockedUnlink.mockResolvedValue(undefined);
      mockedExistsSync.mockReturnValue(true);
      mockedStat.mockImplementation(async () => ({ size: 512 }));
      mockedReadFile.mockImplementation(async () => 'YmFzZTY0');
      mockCoreV1Api.createNamespacedConfigMap.mockImplementation(async () => ({}));

      const result = await service.createConfigMap(archiveFile, 'performance');

      expect(mockedReadFile).toHaveBeenCalledWith('/tmp/archive-script.tar', 'base64');
      expect(mockCoreV1Api.createNamespacedConfigMap).toHaveBeenCalledWith({
        namespace: 'performance',
        body: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'archive-script',
            namespace: 'performance',
          },
          binaryData: {
            'archive-script.tar': 'YmFzZTY0',
          },
        },
      });
      expect(result).toEqual({
        namespace: 'performance',
        configMapName: 'archive-script',
      });
      expect(mockedLoggerInfo).toHaveBeenCalledWith('ConfigMap archive-script created in namespace performance');
    });
  });

  describe('deleteConfigMap', () => {
    test('deletes configmap and logs message on success', async () => {
      mockCoreV1Api.deleteNamespacedConfigMap.mockImplementation(async () => ({}));

      await service.deleteConfigMap('archive-script', 'default');

      expect(mockCoreV1Api.deleteNamespacedConfigMap).toHaveBeenCalledWith({
        name: 'archive-script',
        namespace: 'default',
      });
      expect(mockedLoggerInfo).toHaveBeenCalledWith('ConfigMap archive-script deleted from namespace default');
    });

    test('wraps and throws error when delete fails', async () => {
      mockCoreV1Api.deleteNamespacedConfigMap.mockImplementation(async () => {
        throw new Error('kaboom');
      });

      await expect(service.deleteConfigMap('archive-script', 'default'))
        .rejects.toThrow('Failed to delete ConfigMap archive-script from namespace default: kaboom');
    });
  });
});

describe('createDefaultKubernetesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads kube config and creates KubernetesService without context', () => {
    const service = createDefaultKubernetesService();

    expect(service).toBeInstanceOf(KubernetesService);
    expect(mockedK8sModule.KubeConfig).toHaveBeenCalledTimes(1);
    expect(mockedK8sModule.__mocks.mockLoadFromDefault).toHaveBeenCalledTimes(1);
    expect(mockedK8sModule.__mocks.mockSetCurrentContext).not.toHaveBeenCalled();
    expect(mockedK8sModule.__mocks.mockMakeApiClient).toHaveBeenCalledWith(mockedK8sModule.CoreV1Api);
  });

  test('sets current context when context is provided', () => {
    createDefaultKubernetesService('minikube');

    expect(mockedK8sModule.__mocks.mockSetCurrentContext).toHaveBeenCalledWith('minikube');
    expect(mockedK8sModule.__mocks.mockMakeApiClient).toHaveBeenCalledWith(mockedK8sModule.CoreV1Api);
  });
});
