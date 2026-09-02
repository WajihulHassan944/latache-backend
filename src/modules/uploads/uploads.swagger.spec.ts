import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RegistrationUploadsController, UploadsController } from './uploads.controller';

const assertRoute = (
  controller: object,
  handler: object,
  method: RequestMethod,
  path: string | undefined,
): void => {
  expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe('uploads');
  expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
};

describe('Cloudinary upload route surface', () => {
  it('maps the public registration upload route', () => {
    assertRoute(
      RegistrationUploadsController,
      RegistrationUploadsController.prototype.uploadRegistrationFile,
      RequestMethod.POST,
      'registration',
    );
  });

  it('maps the public registration upload signature route', () => {
    assertRoute(
      RegistrationUploadsController,
      RegistrationUploadsController.prototype.getRegistrationUploadSignature,
      RequestMethod.POST,
      'registration/signature',
    );
  });

  it('maps the authenticated single upload route', () => {
    assertRoute(
      UploadsController,
      UploadsController.prototype.uploadSingle,
      RequestMethod.POST,
      'single',
    );
  });

  it('maps the authenticated single upload signature route', () => {
    assertRoute(
      UploadsController,
      UploadsController.prototype.getUploadSignature,
      RequestMethod.POST,
      'single/signature',
    );
  });

  it('maps the authenticated multiple upload route', () => {
    assertRoute(
      UploadsController,
      UploadsController.prototype.uploadMultiple,
      RequestMethod.POST,
      'multiple',
    );
  });

  it('maps the authenticated multiple upload signature route', () => {
    assertRoute(
      UploadsController,
      UploadsController.prototype.getUploadSignatures,
      RequestMethod.POST,
      'multiple/signature',
    );
  });

  it('maps the authenticated delete route', () => {
    assertRoute(UploadsController, UploadsController.prototype.delete, RequestMethod.DELETE, '/');
  });
});
