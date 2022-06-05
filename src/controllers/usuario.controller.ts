import {
  authenticate,
  TokenService,
  UserService,
} from '@loopback/authentication';
import {authorize} from '@loopback/authorization';
import {inject} from '@loopback/core';
import {
  Count,
  CountSchema,
  DataObject,
  Filter,
  repository,
  Where,
} from '@loopback/repository';
import {
  get,
  getModelSchemaRef,
  HttpErrors,
  param,
  patch,
  post,
  requestBody,
  response,
} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import _ from 'lodash';
import {
  PasswordHasherBindings,
  TokenServiceBindings,
  UserServiceBindings,
} from '../keys';
import {basicAuthorization} from '../middlewares/auth.midd';
import {Usuario} from '../models';
import {
  Credentials,
  LoginCredentials,
  UsuarioRepository,
} from '../repositories';
import {PasswordHasher, validateCredentials} from '../services';
import {
  CredentialsRequestBody,
  LoginRequestBody,
  UserProfileSchema,
} from './specs/user-controller.specs';

export class UserController {
  constructor(
    @repository(UsuarioRepository) public usuarioRepository: UsuarioRepository,
    @inject(PasswordHasherBindings.PASSWORD_HASHER)
    public passwordHasher: PasswordHasher,
    @inject(TokenServiceBindings.TOKEN_SERVICE)
    public jwtService: TokenService,
    @inject(UserServiceBindings.USER_SERVICE)
    public userService: UserService<Usuario, Credentials>,
  ) {}

  @get('/users/count')
  @response(200, {
    description: 'Usuario model count',
    content: {'application/json': {schema: CountSchema}},
  })
  @authenticate('jwt')
  @authorize({
    allowedRoles: ['admin'],
    voters: [basicAuthorization],
  })
  async count(@param.where(Usuario) where?: Where<Usuario>): Promise<Count> {
    return this.usuarioRepository.count(where);
  }

  @get('/users')
  @response(200, {
    description: 'Array of Usuario model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Usuario, {includeRelations: true}),
        },
      },
    },
  })
  @authenticate('jwt')
  @authorize({
    allowedRoles: ['admin'],
    voters: [basicAuthorization],
  })
  async find(
    @param.filter(Usuario) filter?: Filter<Usuario>,
  ): Promise<Usuario[]> {
    return this.usuarioRepository.find(filter);
  }

  @patch('/users/{id}')
  @response(204, {
    description: 'Usuario PATCH success',
  })
  @authenticate('jwt')
  async updateById(
    @param.path.number('id') id: number,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Usuario, {partial: true}),
        },
      },
    })
    user: Usuario,
  ): Promise<void> {
    await this.usuarioRepository.updateById(id, user);
  }

  @post('/users/sign-up', {
    responses: {
      '200': {
        description: 'Usuario',
        content: {
          'application/json': {
            schema: {
              'x-ts-type': Usuario,
            },
          },
        },
      },
    },
  })
  async create(
    @requestBody(CredentialsRequestBody)
    newUserRequest: Credentials,
  ): Promise<Usuario> {
    // por defecto
    newUserRequest.rol = 'user';

    // ensure a valid email value and password value
    validateCredentials(_.pick(newUserRequest, ['usuario', 'password']));

    // encrypt the password
    const password = await this.passwordHasher.hashPassword(
      newUserRequest.password,
    );

    try {
      // create the new user
      const savedUser = await this.usuarioRepository.create(
        _.omit(newUserRequest, 'password') as DataObject<Usuario>,
      );

      // set the password
      await this.usuarioRepository
        .usuarioCredentials(savedUser.id)
        .create({password});

      return savedUser;
    } catch (error) {
      // MongoError 11000 duplicate key
      if (error.code === 11000 && error.errmsg.includes('index: uniqueEmail')) {
        throw new HttpErrors.Conflict('Email value is already taken');
      } else {
        throw error;
      }
    }
  }

  @post('/users/sign-up/admin', {
    responses: {
      '200': {
        description: 'Usuario',
        content: {
          'application/json': {
            schema: {
              'x-ts-type': Usuario,
            },
          },
        },
      },
    },
  })
  async createAdmin(
    @requestBody(CredentialsRequestBody)
    newUserRequest: Credentials,
  ): Promise<Usuario> {
    // All new users have the "customer" rol by default
    newUserRequest.rol = 'admin';
    // ensure a valid email value and password value
    validateCredentials(_.pick(newUserRequest, ['usuario', 'password']));

    // encrypt the password
    const password = await this.passwordHasher.hashPassword(
      newUserRequest.password,
    );

    try {
      // create the new user
      console.log('user: ', newUserRequest);
      const savedUser = await this.usuarioRepository.create(
        _.omit(newUserRequest, 'password') as DataObject<Usuario>,
      );
      console.log('usuario creado: ', savedUser);
      // set the password
      await this.usuarioRepository
        .usuarioCredentials(savedUser.id)
        .create({password});

      return savedUser;
    } catch (error) {
      // MongoError 11000 duplicate key
      console.log('erro al creas usuario: ', error);
      if (error.code === 11000 && error.errmsg.includes('index: uniqueEmail')) {
        throw new HttpErrors.Conflict('Email value is already taken');
      } else {
        throw error;
      }
    }
  }

  @get('/users/{userId}', {
    responses: {
      '200': {
        description: 'Usuario',
        content: {
          'application/json': {
            schema: {
              'x-ts-type': Usuario,
            },
          },
        },
      },
    },
  })
  @authenticate('jwt')
  @authorize({
    allowedRoles: ['admin'],
    voters: [basicAuthorization],
  })
  async findById(
    @param.path.number('userId') userId: number,
  ): Promise<Usuario> {
    return this.usuarioRepository.findById(userId);
  }

  @get('/users/me', {
    responses: {
      '200': {
        description: 'The current user profile',
        content: {
          'application/json': {
            schema: UserProfileSchema,
          },
        },
      },
    },
  })
  @authenticate('jwt')
  async printCurrentUser(
    @inject(SecurityBindings.USER)
    currentUserProfile: UserProfile,
  ): Promise<Usuario> {
    const userId = currentUserProfile[securityId];
    return this.usuarioRepository.findById(parseInt(userId));
  }

  @post('/users/login', {
    responses: {
      '200': {
        description: 'Token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                token: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
  })
  async login(
    @requestBody(LoginRequestBody) loginCredentials: LoginCredentials,
  ): Promise<{token: string; usuario: Usuario}> {
    // ensure the user exists, and the password is correct
    const user = await this.userService.verifyCredentials(loginCredentials);

    // convert a Usuario object into a UserProfile object (reduced set of properties)
    const userProfile = this.userService.convertToUserProfile(user);

    // create a JSON Web Token based on the user profile
    const token = await this.jwtService.generateToken(userProfile);
    return {
      token,
      usuario: user,
    };
  }
}