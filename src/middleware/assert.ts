import * as path from 'path';
import * as nconf from 'nconf';
import { Response } from 'express'; // Import Response
import * as file from '../file';
import * as user from '../user';
import * as groups from '../groups';
import * as topics from '../topics';
import * as posts from '../posts';
import * as messaging from '../messaging';
import * as flags from '../flags';
import * as slugify from '../slugify';
import * as helpers from './helpers';
import * as controllerHelpers from '../controllers/helpers';


interface CustomRequest {
    params: { [key: string]: string }; // Adjust the type according to your usage
    body: CustomRequestBody; // Define the type for req.body
    uid?: string;
}

interface CustomRequestBody {
    folderName?: string;
}

interface CustomResponse {
    locals: {
        cleanedPath?: string;
        folderPath?: string;
    };
    status: (status: number) => CustomResponse;
    json: (body: string) => void;
}

type NextFunction = () => void;

const Assert = {
    user: helpers.try(async (req: CustomRequest, res: Response, next: NextFunction) => {
        if (!await user.exists(req.params.uid)) {
            return controllerHelpers.formatApiResponse(404, res, new Error('[[error:no-user]]'));
        }
        next();
    }),

    group: helpers.try(async (req: CustomRequest, res: Response, next: NextFunction) => {
        const name = await groups.getGroupNameByGroupSlug(req.params.slug) as string | null;
        if (!name || !await groups.exists(name)) {
            return controllerHelpers.formatApiResponse(404, res, new Error('[[error:no-group]]'));
        }
        next();
    }),

    topic: helpers.try(async (req: CustomRequest, res: Response, next: NextFunction) => {
        if (!await topics.exists(req.params.tid)) {
            return controllerHelpers.formatApiResponse(404, res, new Error('[[error:no-topic]]'));
        }

        next();
    }),

    post: helpers.try(async (req: CustomRequest, res: Response, next: NextFunction) => {
        if (!await posts.exists(req.params.pid)) {
            return controllerHelpers.formatApiResponse(404, res, new Error('[[error:no-post]]'));
        }

        next();
    }),

    flag: helpers.try(async (req: CustomRequest, res: Response, next: NextFunction) => {
        if (!req.uid) {
            return controllerHelpers.formatApiResponse(400, res, new Error('User ID is missing'));
        }
        const canView = await flags.canView(req.params.flagId, req.uid) as boolean;

        if (!canView) {
            return controllerHelpers.formatApiResponse(404, res, new Error('[[error:no-flag]]'));
        }

        next();
    }),

    path: helpers.try(async (req: CustomRequest, res: CustomResponse, next: NextFunction) => {
        const body = req.body as { path?: string };
        const uploadUrl = nconf.get('upload_url') as string;
        const uploadPath = nconf.get('upload_path') as string;

        if (body.path && uploadUrl && body.path.startsWith(uploadUrl)) {
            body.path = body.path.slice(uploadUrl.length);
        }

        const pathToFile = path.join(uploadPath, body.path || '');
        res.locals.cleanedPath = pathToFile;

        if (!pathToFile.startsWith(uploadPath)) {
            return controllerHelpers.formatApiResponse(403, res, new Error('[[error:invalid-path]]'));
        }

        if (!await file.exists(pathToFile)) {
            return controllerHelpers.formatApiResponse(404, res, new Error('[[error:invalid-path]]'));
        }

        next();
    }),

    folderName: helpers.try(async (req: CustomRequest, res: CustomResponse, next: NextFunction) => {
        const { body } = req;
        const folderName = slugify(path.basename(body.folderName?.trim() ?? '')) as string;

        if (!folderName) {
            return controllerHelpers.formatApiResponse(403, res, new Error('[[error:invalid-path]]'));
        }

        if (!res.locals.cleanedPath) {
            return controllerHelpers.formatApiResponse(500, res, new Error('Server configuration error'));
        }

        const folderPath = path.join(res.locals.cleanedPath, folderName);

        if (await file.exists(folderPath)) {
            return controllerHelpers.formatApiResponse(403, res, new Error('[[error:folder-exists]]'));
        }

        res.locals.folderPath = folderPath;

        next();
    }),

    room: helpers.try(async (req: CustomRequest, res: Response, next: NextFunction) => {
        const roomId = parseInt(req.params.roomId, 10);

        if (!isFinite(roomId)) {
            return controllerHelpers.formatApiResponse(400, res, new Error('[[error:invalid-data]]'));
        }
        const roomExistsFunction = messaging.roomExists as unknown as (roomId: number) => Promise<boolean>;
        const isUserInRoomFunction: (uid: string, roomId: number) => Promise<boolean> =
            messaging.isUserInRoom as unknown as (uid: string, roomId: number) => Promise<boolean>;
        const [exists, inRoom] = await Promise.all([
            roomExistsFunction(roomId),
            isUserInRoomFunction(req.uid, roomId),
        ]);

        if (!exists) {
            return controllerHelpers.formatApiResponse(404, res, new Error('[[error:chat-room-does-not-exist]]'));
        }

        if (!inRoom) {
            return controllerHelpers.formatApiResponse(403, res, new Error('[[error:no-privileges]]'));
        }

        next();
    }),

    message: helpers.try(async (req: CustomRequest, res: Response, next: NextFunction) => {
        const messageId = parseInt(req.params.mid, 10);

        if (!isFinite(messageId) ||
        !(await messaging.messageExists(messageId)) ||
        !(await messaging.canViewMessage(messageId, req.params.roomId, req.uid))) {
            return controllerHelpers.formatApiResponse(400, res, new Error('[[error:invalid-mid]]'));
        }

        next();
    }),
};

export default Assert;
